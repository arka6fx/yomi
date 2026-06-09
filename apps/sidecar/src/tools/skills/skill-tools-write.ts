// Agent-facing tool surface for procedural-memory skills. `createSkillTools`
// is the factory the existing `tools/index.ts` calls. Read tools work on
// every plan; write tools (Stage 3) require a Pro/Max plan via
// `checkSkillWriteAccess`. The threat guard is wired in Stage 4 — for now the
// tools just enforce the plan and call the store.

import { jsonSchema, tool, type ToolSet } from "ai"
import type { Plan } from "@yomi/shared"
import {
  archiveSkill,
  countActiveSkills,
  editSkill,
  readSkill,
  removeSkillFile,
  unarchiveSkill,
  writeSkill,
  writeSkillFile,
  SkillNotFoundError,
  SkillPathError,
  SkillValidationError,
  SkillAlreadyExistsError,
} from "./skill-store.js"
import {
  canMutateSkill,
  isReadOnlyPlan,
  validateSkillBody,
  validateSkillDescription,
  validateSkillName,
} from "./skill-types.js"
import { checkSkillWriteAccess } from "./skill-entitlement.js"
import { guardSkillWrite } from "./skills-guard.js"
import { createSkillReadTools } from "./skill-tools-read.js"
import { refreshSkillIndexBlock } from "../../harness/prompt.js"
import type { SkillFull, SkillManifest } from "./skill-types.js"

export interface SkillToolsContext {
  plan?: Plan | undefined
}

export interface SkillWriteResult {
  ok: boolean
  name?: string
  // Echoed back to the model so it can confirm what landed.
  manifest?: SkillManifest
  body_chars?: number
  // The archive path on `skill_delete`; the restored path on
  // `skill_unarchive`.
  archive_path?: string
  // Failure reason — kept terse so the model can react.
  reason?: string
  // Plan-gate errors go here so the model can render a clear upgrade prompt.
  upgrade_url?: string
}

function deny(reason: string): SkillWriteResult {
  return { ok: false, reason }
}

function denyUpgrade(reason: string): SkillWriteResult {
  return { ok: false, reason, upgrade_url: "https://yomi.example.com/upgrade" }
}

function checkReadOnlyOrUpgrade(plan: Plan | undefined): SkillWriteResult | null {
  if (!isReadOnlyPlan(plan)) return null
  return denyUpgrade("skill writes require a Pro plan (Explore is read-only)")
}

// Schedule a refresh of the system-prompt skill index after the current write
// commits. The refresh runs in the background so the agent's reply returns
// promptly; a freshly written skill surfaces in the NEXT prompt.
function scheduleSkillIndexRefresh(): void {
  void refreshSkillIndexBlock().catch(() => {
    // Refresh failures are non-fatal — the next prompt will retry.
  })
}

// Single-pass scan for oldText, then replace. `allOccurrences` controls how
// many matches are replaced (default: all). Returns the new body, or null
// when no match was found.
function patchReplace(
  body: string,
  oldText: string,
  newText: string,
  allOccurrences: boolean,
): string | null {
  if (!oldText) return null
  if (allOccurrences) {
    if (!body.includes(oldText)) return null
    return body.split(oldText).join(newText)
  }
  const idx = body.indexOf(oldText)
  if (idx === -1) return null
  return body.slice(0, idx) + newText + body.slice(idx + oldText.length)
}

export function createSkillWriteTools(ctx: SkillToolsContext): ToolSet {
  return {
    skill_create: tool({
      description:
        "Create a new procedural-memory skill from a proven approach. Use after solving a task to capture the steps for next time. Bundled skills are read-only.",
      parameters: jsonSchema<{
        name: string
        description: string
        body: string
        version?: string
        author?: string
        platforms?: string[]
        pinned?: boolean
        tags?: string[]
        relatedSkills?: string[]
      }>({
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name (lowercase, hyphens, max 64 chars)." },
          description: { type: "string", description: "One-line description, max 1024 chars." },
          body: { type: "string", description: "Skill markdown body, max 64 KiB." },
          version: { type: "string" },
          author: { type: "string" },
          platforms: { type: "array", items: { type: "string" } },
          pinned: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          relatedSkills: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "body"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        try {
          validateSkillName(args.name)
          validateSkillDescription(args.description)
          validateSkillBody(args.body)
        } catch (err) {
          return deny(err instanceof Error ? err.message : String(err))
        }
        const currentCount = await countActiveSkills()
        const access = checkSkillWriteAccess(ctx.plan, null, currentCount, "create")
        if (!access.ok) return deny(access.reason ?? "create denied")

        // Guard scan before any disk write — body + manifest fields run through
        // the strict-scope threat lib plus a few skill-specific patterns.
        const guard = guardSkillWrite(args.body, {
          manifest: {
            name: args.name,
            description: args.description,
            version: args.version ?? "1.0.0",
            author: args.author,
            platforms: args.platforms,
            createdBy: "agent",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pinned: args.pinned,
          },
        })
        if (!guard.ok) return deny(guard.reason)

        try {
          const result: SkillFull = await writeSkill(args.name, args.body, {
            manifest: {
              name: args.name,
              description: args.description,
              version: args.version,
              author: args.author,
              platforms: args.platforms,
              createdBy: "agent",
              pinned: args.pinned,
              metadata: {
                yomi: {
                  tags: args.tags && args.tags.length > 0 ? args.tags : undefined,
                  relatedSkills:
                    args.relatedSkills && args.relatedSkills.length > 0
                      ? args.relatedSkills
                      : undefined,
                },
              },
            },
          })
          scheduleSkillIndexRefresh()
          return {
            ok: true,
            name: result.manifest.name,
            manifest: result.manifest,
            body_chars: result.body.length,
          }
        } catch (err) {
          if (err instanceof SkillAlreadyExistsError) {
            return deny(`skill already exists: ${args.name}`)
          }
          if (err instanceof SkillValidationError) {
            return deny(err.message)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),

    skill_edit: tool({
      description:
        "Replace the full body of a skill. Use this for major rewrites; for targeted edits prefer skill_patch.",
      parameters: jsonSchema<{
        name: string
        body: string
        description?: string
        version?: string
        pinned?: boolean
      }>({
        type: "object",
        properties: {
          name: { type: "string" },
          body: { type: "string" },
          description: { type: "string" },
          version: { type: "string" },
          pinned: { type: "boolean" },
        },
        required: ["name", "body"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        try {
          validateSkillBody(args.body)
        } catch (err) {
          return deny(err instanceof Error ? err.message : String(err))
        }
        let existing: SkillFull
        try {
          existing = await readSkill(args.name)
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return deny(`skill not found: ${args.name}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
        if (!canMutateSkill(ctx.plan, existing.manifest)) {
          return deny("bundled skills are read-only on every plan")
        }

        // Guard scan against the new body + the would-be merged manifest.
        const merged: SkillManifest = {
          ...existing.manifest,
          description: args.description ?? existing.manifest.description,
          version: args.version ?? existing.manifest.version,
          pinned: args.pinned ?? existing.manifest.pinned,
        }
        const guard = guardSkillWrite(args.body, { manifest: merged })
        if (!guard.ok) return deny(guard.reason)

        try {
          const result = await editSkill(args.name, args.body, {
            manifest: {
              description: args.description,
              version: args.version,
              pinned: args.pinned,
            },
          })
          scheduleSkillIndexRefresh()
          return {
            ok: true,
            name: result.manifest.name,
            manifest: result.manifest,
            body_chars: result.body.length,
          }
        } catch (err) {
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),

    skill_patch: tool({
      description:
        "Targeted find-and-replace inside a skill's body. Pass allOccurrences=true to replace every match; the default is the first match only.",
      parameters: jsonSchema<{
        name: string
        oldText: string
        newText: string
        allOccurrences?: boolean
      }>({
        type: "object",
        properties: {
          name: { type: "string" },
          oldText: { type: "string", description: "Substring to find (must be non-empty)." },
          newText: { type: "string" },
          allOccurrences: {
            type: "boolean",
            description: "Default false. Set true to replace every match.",
          },
        },
        required: ["name", "oldText", "newText"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        let existing: SkillFull
        try {
          existing = await readSkill(args.name)
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return deny(`skill not found: ${args.name}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
        if (!canMutateSkill(ctx.plan, existing.manifest)) {
          return deny("bundled skills are read-only on every plan")
        }
        const all = args.allOccurrences === true
        const newBody = patchReplace(existing.body, args.oldText, args.newText, all)
        if (newBody === null) {
          return deny(
            `skill_patch: oldText not found in ${args.name}` +
              (all ? "" : " (and allOccurrences=false; first match missing)"),
          )
        }
        // Guard scan the patched body before writing it.
        const guard = guardSkillWrite(newBody, { manifest: existing.manifest })
        if (!guard.ok) return deny(guard.reason)
        try {
          const result = await editSkill(args.name, newBody)
          scheduleSkillIndexRefresh()
          return {
            ok: true,
            name: result.manifest.name,
            manifest: result.manifest,
            body_chars: result.body.length,
          }
        } catch (err) {
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),

    skill_delete: tool({
      description:
        "Soft-delete a skill: moves the directory to ~/.yomi/skills/.archive/ so the user can un-archive later.",
      parameters: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        let existing: SkillFull
        try {
          existing = await readSkill(args.name)
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return deny(`skill not found: ${args.name}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
        if (!canMutateSkill(ctx.plan, existing.manifest)) {
          return deny("bundled skills are read-only on every plan")
        }
        try {
          const archivePath = await archiveSkill(args.name)
          scheduleSkillIndexRefresh()
          return { ok: true, name: args.name, archive_path: archivePath }
        } catch (err) {
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),

    skill_unarchive: tool({
      description:
        "Restore the most recently archived copy of a skill. Counterpart to skill_delete.",
      parameters: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        try {
          const path = await unarchiveSkill(args.name)
          scheduleSkillIndexRefresh()
          return { ok: true, name: args.name, archive_path: path }
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return deny(`no archive found for ${args.name}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),

    skill_write_file: tool({
      description:
        "Add or overwrite a supporting file inside a skill (references, scripts, assets). Max 1 MiB. Path traversal blocked.",
      parameters: jsonSchema<{ name: string; path: string; content: string }>({
        type: "object",
        properties: {
          name: { type: "string" },
          path: {
            type: "string",
            description: "Path relative to the skill dir (e.g. references/foo.md).",
          },
          content: { type: "string" },
        },
        required: ["name", "path", "content"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        let existing: SkillFull
        try {
          existing = await readSkill(args.name)
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return deny(`skill not found: ${args.name}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
        if (!canMutateSkill(ctx.plan, existing.manifest)) {
          return deny("bundled skills are read-only on every plan")
        }
        try {
          const absPath = await writeSkillFile(args.name, args.path, args.content)
          return {
            ok: true,
            name: args.name,
            archive_path: absPath,
          }
        } catch (err) {
          if (err instanceof SkillPathError) {
            return deny(`invalid path: ${err.message}`)
          }
          if (err instanceof SkillValidationError) {
            return deny(err.message)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),

    skill_remove_file: tool({
      description:
        "Remove a supporting file from a skill. Counterpart to skill_write_file. Path traversal blocked.",
      parameters: jsonSchema<{ name: string; path: string }>({
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string" },
        },
        required: ["name", "path"],
      }),
      execute: async (args): Promise<SkillWriteResult> => {
        const upgrade = checkReadOnlyOrUpgrade(ctx.plan)
        if (upgrade) return upgrade
        let existing: SkillFull
        try {
          existing = await readSkill(args.name)
        } catch (err) {
          if (err instanceof SkillNotFoundError) {
            return deny(`skill not found: ${args.name}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
        if (!canMutateSkill(ctx.plan, existing.manifest)) {
          return deny("bundled skills are read-only on every plan")
        }
        try {
          await removeSkillFile(args.name, args.path)
          return { ok: true, name: args.name }
        } catch (err) {
          if (err instanceof SkillPathError) {
            return deny(`invalid path: ${err.message}`)
          }
          return deny(err instanceof Error ? err.message : String(err))
        }
      },
    }),
  }
}

// One-call factory used by tools/index.ts. Combines read + write tools and
// returns the merged ToolSet.
export function createSkillTools(ctx: SkillToolsContext): ToolSet {
  return {
    ...createSkillReadTools(ctx),
    ...createSkillWriteTools(ctx),
  }
}

// Read-only factory for fast-path or restricted deployments.
export function createReadOnlySkillTools(ctx: SkillToolsContext): ToolSet {
  return createSkillReadTools(ctx)
}
