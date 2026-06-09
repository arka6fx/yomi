// Agent-facing tool surface for procedural-memory skills. `createSkillTools`
// is the factory the existing `tools/index.ts` calls. Read tools are
// registered on every plan; write tools are added in Stage 3 (Pro+ only).
//
// Telemetry (`recordSkillView`, `recordSkillFileView`) is intentionally
// deferred to Stage 6 — the read tools return data first so we can ship
// the system-prompt integration (Stage 5) without depending on the curator's
// usage-sidecar.

import { jsonSchema, tool, type ToolSet } from "ai"
import type { Plan } from "@yomi/shared"
import { listSkills, readSkill, readSkillFile, SkillNotFoundError } from "./skill-store.js"
import { isReadOnlyPlan } from "./skill-types.js"
import { getUsage, recordSkillFileView, recordSkillView } from "./skill-usage.js"
import type { SkillSummary } from "./skill-types.js"

export interface SkillToolsContext {
  plan?: Plan | undefined
}

export interface SkillListResult {
  skills: SkillSummary[]
  total: number
  // Surfaced to the model so it can ask the user to upgrade when the list
  // is empty on Explore. Not a hard error — read tools still work.
  readOnly: boolean
}

export interface SkillViewResult {
  name: string
  description: string
  version: string
  body: string
  files: string[]
  manifest: {
    createdBy: string
    createdAt: string
    updatedAt: string
    pinned: boolean
    platforms?: string[]
    metadata?: unknown
  }
}

function summarise(
  summary: SkillSummary,
  extras: { lastActivityAt: string | null; useCount: number; viewCount: number },
): SkillSummary {
  return { ...summary, ...extras }
}

function readUsageSummary(name: string): Promise<{
  lastActivityAt: string | null
  useCount: number
  viewCount: number
}> {
  // Synchronous read from the in-memory JSON sidecar; cheap enough to call
  // once per list row. The sidecar is small (one entry per skill).
  return Promise.resolve(getUsage(name)).then((r) => ({
    lastActivityAt: r.last_activity_at,
    useCount: r.use_count,
    viewCount: r.view_count,
  }))
}

export function createSkillReadTools(_ctx: SkillToolsContext): ToolSet {
  return {
    skill_list: tool({
      description:
        "List every available procedural-memory skill with a one-line description. Use this to discover what reusable approaches the agent has already learned before solving a task from scratch.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async (): Promise<SkillListResult> => {
        const all = await listSkills()
        const summaries: SkillSummary[] = []
        for (const entry of all) {
          if (!entry.manifest && !entry.parseError) continue
          const usage = await readUsageSummary(entry.summary.name)
          summaries.push(summarise(entry.summary, usage))
        }
        return {
          skills: summaries,
          total: summaries.length,
          readOnly: isReadOnlyPlan(_ctx.plan),
        }
      },
    }),

    skill_view: tool({
      description:
        "Load the full body of a skill — the reusable step-by-step approach. Call this when a skill listed in skill_list looks relevant to the current task.",
      parameters: jsonSchema<{ name: string }>({
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Skill name as returned by skill_list (lowercase, hyphens).",
          },
        },
        required: ["name"],
      }),
      execute: async ({ name }): Promise<SkillViewResult | { error: string }> => {
        try {
          const skill = await readSkill(name)
          // Telemetry: bump use_count, set last_activity_at, mirror pinned so
          // the curator can fast-skip without re-reading the manifest.
          await recordSkillView(name, { pinned: skill.manifest.pinned === true })
          return {
            name: skill.manifest.name,
            description: skill.manifest.description,
            version: skill.manifest.version,
            body: skill.body,
            files: skill.files,
            manifest: {
              createdBy: skill.manifest.createdBy,
              createdAt: skill.manifest.createdAt,
              updatedAt: skill.manifest.updatedAt,
              pinned: skill.manifest.pinned === true,
              platforms: skill.manifest.platforms,
              metadata: skill.manifest.metadata,
            },
          }
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return { error: `skill not found: ${name}` }
          }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    skill_read_file: tool({
      description:
        "Read a supporting file from a skill's references/ or scripts/ directory. Use after skill_view to load only the file you need.",
      parameters: jsonSchema<{ name: string; path: string }>({
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Skill name as returned by skill_list.",
          },
          path: {
            type: "string",
            description: "File path relative to the skill directory (e.g. references/foo.md).",
          },
        },
        required: ["name", "path"],
      }),
      execute: async ({ name, path }): Promise<{ content?: string; error?: string }> => {
        // Check skill existence first so a missing skill produces a clean
        // "skill not found" error rather than a raw ENOENT from the file
        // open below. Reading the skill also tells us the manifest's pinned
        // flag so the telemetry record mirrors it.
        try {
          const skill = await readSkill(name)
          await recordSkillFileView(name).catch(() => {
            // Telemetry failures are non-fatal — the read still succeeds.
          })
          // Avoid an unused-var lint warning when the file read below fails.
          void skill
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return { error: `skill not found: ${name}` }
          }
          return { error: err instanceof Error ? err.message : String(err) }
        }
        try {
          const content = await readSkillFile(name, path)
          return { content }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),
  }
}
