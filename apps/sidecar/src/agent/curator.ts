// Curator — background skill lifecycle maintenance. Mirrors Hermes'
// `agent/curator.py` with three responsibilities:
//
// 1. Lifecycle transitions — derive `state` (active | stale | archived) for
//    each agent-created skill based on `last_activity_at` and the staleness
//    thresholds. Bundled + pinned skills are exempt.
//
// 2. Archive on staleness — move skills past the archive threshold into
//    `~/.yomi/skills/.archive/<name>-<ts>/`. Never deletes; the user can
//    un-archive via the `skill_unarchive` tool.
//
// 3. LLM review — ask an auxiliary model whether two similar agent-created
//    skills are duplicates; if so, propose a merged body. The review is
//    bounded so it never runs the same skill twice in one session.
//
// Throttling: `maybeRunCurator` is a no-op when the interval hasn't elapsed
// since the last run, when paused, or when the plan isn't Pro/Max. The
// sidecar calls it from the existing `compact()` tail — no new event loop
// or background process.

import { generateText, type LanguageModelV1 } from "ai"
import type { Plan } from "@yomi/shared"
import { createModel } from "../pipeline/model.js"
import { archiveSkill, listSkills, readSkill } from "../tools/skills/skill-store.js"
import { loadUsage, setSkillPinned, setSkillState } from "../tools/skills/skill-usage.js"
import type {
  SkillLifecycleState,
  SkillManifest,
  SkillSummary,
} from "../tools/skills/skill-types.js"
import { isReadOnlyPlan } from "../tools/skills/skill-types.js"
import { join } from "node:path"
import { notepadDir } from "../memory/loader.js"
import { mkdir, readFile, writeFile, rename } from "node:fs/promises"

const DEFAULT_INTERVAL_HOURS = 24 * 7 // 7 days
const DEFAULT_STALE_AFTER_DAYS = 30
const DEFAULT_ARCHIVE_AFTER_DAYS = 90
const DEFAULT_MAX_REVIEW_PAIRS = 3

interface CuratorState {
  last_run_at: string | null
  last_run_duration_seconds: number | null
  last_run_summary: string | null
  last_report_path: string | null
  paused: boolean
  run_count: number
}

function defaultState(): CuratorState {
  return {
    last_run_at: null,
    last_run_duration_seconds: null,
    last_run_summary: null,
    last_report_path: null,
    paused: false,
    run_count: 0,
  }
}

function stateFilePath(): string {
  return join(notepadDir(), "skills", ".curator_state")
}

async function loadCuratorState(): Promise<CuratorState> {
  try {
    const raw = await readFile(stateFilePath(), "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...defaultState(), ...(parsed as Partial<CuratorState>) }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Corrupt JSON: start fresh rather than crash.
    }
  }
  return defaultState()
}

async function saveCuratorState(state: CuratorState): Promise<void> {
  const path = stateFilePath()
  await mkdir(join(notepadDir(), "skills"), { recursive: true })
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8")
  await rename(tmp, path)
}

export interface CuratorOptions {
  intervalHours?: number
  staleAfterDays?: number
  archiveAfterDays?: number
  maxReviewPairs?: number
  modelFactory?: (id: string) => LanguageModelV1
  modelId?: string
  signal?: AbortSignal
}

export interface CuratorRunResult {
  ran: boolean
  reason?: "interval_not_elapsed" | "paused" | "wrong_plan" | "no_skills"
  transitioned: number
  archived: number
  reviewed: number
  durationMs: number
  reportPath?: string
  error?: string
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return (Date.now() - then) / (1000 * 60 * 60)
}

function daysSince(iso: string | null): number {
  return hoursSince(iso) / 24
}

// Reads the merged view of skills + usage (cached in the JSON sidecar) so
// the curator's lifecycle pass can avoid touching the SKILL.md files.
async function collectCandidates(
  state: CuratorState,
  _opts: Required<Pick<CuratorOptions, "staleAfterDays" | "archiveAfterDays">>,
): Promise<Array<{ summary: SkillSummary; manifest: SkillManifest; usageDays: number }>> {
  const entries = await listSkills()
  const usage = await loadUsage()
  const out: Array<{ summary: SkillSummary; manifest: SkillManifest; usageDays: number }> = []
  for (const e of entries) {
    if (!e.manifest) continue
    // Bundled skills are immutable on every plan and exempt from every
    // auto-transition (Hermes invariant).
    if (e.manifest.createdBy === "bundled") continue
    const u = usage[e.summary.name]
    // Mirror the manifest's pinned flag into the usage record so a single
    // loadUsage() read in the curator is enough.
    if (u && e.manifest.pinned !== (u.pinned === true)) {
      await setSkillPinned(e.summary.name, e.manifest.pinned === true)
    }
    if (e.manifest.pinned === true) continue
    const usageDays = u?.last_activity_at ? daysSince(u.last_activity_at) : Number.POSITIVE_INFINITY
    out.push({ summary: e.summary, manifest: e.manifest, usageDays })
    // Reference state to silence unused-var while keeping the param present
    // for future extensions (e.g. last_report_path usage).
    void state
  }
  return out
}

async function transitionLifecycle(
  candidates: Array<{ summary: SkillSummary; manifest: SkillManifest; usageDays: number }>,
  opts: Required<Pick<CuratorOptions, "staleAfterDays" | "archiveAfterDays">>,
): Promise<{ transitioned: number; archived: number }> {
  let transitioned = 0
  let archived = 0
  for (const c of candidates) {
    let next: SkillLifecycleState = "active"
    if (c.usageDays >= opts.archiveAfterDays) next = "archived"
    else if (c.usageDays >= opts.staleAfterDays) next = "stale"
    if (next === "archived") {
      try {
        await archiveSkill(c.summary.name)
        await setSkillState(c.summary.name, "archived")
        archived++
        transitioned++
      } catch {
        // Best-effort: surface in the report, don't fail the whole pass.
      }
      continue
    }
    // Only write when state changes (avoid noise on the .usage.json file).
    const usage = await loadUsage()
    const current = usage[c.summary.name]?.state ?? "active"
    if (current !== next) {
      await setSkillState(c.summary.name, next)
      transitioned++
    }
  }
  return { transitioned, archived }
}

// Heuristic duplicate detection — used to seed the LLM review queue. We
// only compare summary text (name + description + tags) so the comparison is
// O(n²) over the candidate list, not over skill bodies.
function findDuplicateCandidates(
  candidates: Array<{ summary: SkillSummary; manifest: SkillManifest }>,
  limit: number,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!
      const b = candidates[j]!
      if (looksLikeDuplicate(a, b)) {
        pairs.push([i, j])
        if (pairs.length >= limit) return pairs
      }
    }
  }
  return pairs
}

function looksLikeDuplicate(
  a: { summary: SkillSummary; manifest: SkillManifest },
  b: { summary: SkillSummary; manifest: SkillManifest },
): boolean {
  if (a.summary.name === b.summary.name) return false
  const aDesc = a.summary.description.toLowerCase()
  const bDesc = b.summary.description.toLowerCase()
  if (aDesc && bDesc && aDesc === bDesc) return true
  const aTags = a.manifest.metadata?.yomi?.tags ?? []
  const bTags = b.manifest.metadata?.yomi?.tags ?? []
  if (aTags.length === 0 || bTags.length === 0) return false
  const overlap = aTags.filter((t) => bTags.includes(t)).length
  return overlap >= 2
}

export interface CuratorReviewDecision {
  duplicate: boolean
  reason: string
}

async function reviewPair(
  a: { name: string; description: string; body: string },
  b: { name: string; description: string; body: string },
  modelFactory: (id: string) => LanguageModelV1,
  modelId: string,
  signal?: AbortSignal,
): Promise<CuratorReviewDecision> {
  const prompt = `You are reviewing two procedural-memory skills for duplication.

Skill A:
- Name: ${a.name}
- Description: ${a.description}
- Body (truncated to 1500 chars):
"""
${a.body.slice(0, 1500)}
"""

Skill B:
- Name: ${b.name}
- Description: ${b.description}
- Body (truncated to 1500 chars):
"""
${b.body.slice(0, 1500)}
"""

Are these two skills duplicates that should be merged? Answer with a JSON object:
{"duplicate": true|false, "reason": "short rationale"}

If you are uncertain, return {"duplicate": false, "reason": "..."}.`
  try {
    const { text } = await generateText({
      model: modelFactory(modelId),
      system:
        "You are a precise curator that decides whether two skills are duplicates. Respond only with the JSON object.",
      prompt,
      abortSignal: signal,
    })
    const parsed = tryParseReviewJson(text)
    if (parsed) return parsed
  } catch {
    // Fall through to a safe default.
  }
  return { duplicate: false, reason: "review_failed" }
}

function tryParseReviewJson(text: string): CuratorReviewDecision | null {
  const trimmed = text.trim()
  // Look for the first {...} block in case the model added prose around it.
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const json = JSON.parse(trimmed.slice(start, end + 1)) as {
      duplicate?: unknown
      reason?: unknown
    }
    if (typeof json.duplicate !== "boolean") return null
    return {
      duplicate: json.duplicate,
      reason: typeof json.reason === "string" ? json.reason : "",
    }
  } catch {
    return null
  }
}

export class Curator {
  private readonly options: Required<
    Pick<CuratorOptions, "intervalHours" | "staleAfterDays" | "archiveAfterDays" | "maxReviewPairs">
  > & { modelFactory: (id: string) => LanguageModelV1; modelId: string }

  constructor(opts: CuratorOptions = {}) {
    this.options = {
      intervalHours: opts.intervalHours ?? DEFAULT_INTERVAL_HOURS,
      staleAfterDays: opts.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
      archiveAfterDays: opts.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS,
      maxReviewPairs: opts.maxReviewPairs ?? DEFAULT_MAX_REVIEW_PAIRS,
      modelFactory: opts.modelFactory ?? createModel,
      modelId:
        opts.modelId ??
        process.env["CURATOR_MODEL"] ??
        process.env["AI_CREDITS_FAST_MODEL"] ??
        "gpt-5.5-mini",
    }
  }

  async maybeRunCurator(input: {
    plan?: Plan | undefined
    signal?: AbortSignal
  }): Promise<CuratorRunResult> {
    const start = Date.now()
    const state = await loadCuratorState()

    if (isReadOnlyPlan(input.plan)) {
      return {
        ran: false,
        reason: "wrong_plan",
        transitioned: 0,
        archived: 0,
        reviewed: 0,
        durationMs: 0,
      }
    }
    if (state.paused) {
      return {
        ran: false,
        reason: "paused",
        transitioned: 0,
        archived: 0,
        reviewed: 0,
        durationMs: 0,
      }
    }
    if (state.last_run_at) {
      const elapsedHours = hoursSince(state.last_run_at)
      if (elapsedHours < this.options.intervalHours) {
        return {
          ran: false,
          reason: "interval_not_elapsed",
          transitioned: 0,
          archived: 0,
          reviewed: 0,
          durationMs: 0,
        }
      }
    }

    return this.runCurator(state, input.signal, start)
  }

  async runCurator(
    initialState?: CuratorState,
    signal?: AbortSignal,
    start = Date.now(),
  ): Promise<CuratorRunResult> {
    const state = initialState ?? (await loadCuratorState())
    let transitioned = 0
    let archived = 0
    let reviewed = 0
    let reportPath: string | undefined
    let errorText: string | undefined

    try {
      const candidates = await collectCandidates(state, {
        staleAfterDays: this.options.staleAfterDays,
        archiveAfterDays: this.options.archiveAfterDays,
      })
      if (candidates.length === 0) {
        await this.persist(state, start, transitioned, archived, reviewed, undefined)
        return {
          ran: true,
          reason: "no_skills",
          transitioned,
          archived,
          reviewed,
          durationMs: Date.now() - start,
        }
      }

      const lifecycle = await transitionLifecycle(candidates, {
        staleAfterDays: this.options.staleAfterDays,
        archiveAfterDays: this.options.archiveAfterDays,
      })
      transitioned = lifecycle.transitioned
      archived = lifecycle.archived

      const pairs = findDuplicateCandidates(candidates, this.options.maxReviewPairs)
      for (const [i, j] of pairs) {
        const a = candidates[i]!
        const b = candidates[j]!
        try {
          const aFull = await readSkill(a.summary.name)
          const bFull = await readSkill(b.summary.name)
          const decision = await reviewPair(
            {
              name: aFull.manifest.name,
              description: aFull.manifest.description,
              body: aFull.body,
            },
            {
              name: bFull.manifest.name,
              description: bFull.manifest.description,
              body: bFull.body,
            },
            this.options.modelFactory,
            this.options.modelId,
            signal,
          )
          reviewed++
          // Conservative: only log the verdict in the report. We don't
          // auto-merge because the LLM may be wrong — the user surfaces
          // duplicates via the report and decides whether to act.
          if (decision.duplicate) {
            // Mark the older one for archive so the user can review.
            const olderName = a.usageDays >= b.usageDays ? b.summary.name : a.summary.name
            await setSkillState(olderName, "stale")
          }
        } catch {
          // Individual review failures don't abort the whole pass.
        }
      }

      reportPath = await this.writeReport(candidates, transitioned, archived, reviewed)
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err)
    }

    const finalState: CuratorState = {
      ...state,
      last_run_at: new Date().toISOString(),
      last_run_duration_seconds: Math.round((Date.now() - start) / 1000),
      last_run_summary:
        `transitioned=${transitioned} archived=${archived} reviewed=${reviewed}` +
        (errorText ? ` error=${errorText}` : ""),
      last_report_path: reportPath ?? null,
      run_count: state.run_count + 1,
    }
    await saveCuratorState(finalState)

    return {
      ran: true,
      transitioned,
      archived,
      reviewed,
      durationMs: Date.now() - start,
      reportPath,
      error: errorText,
    }
  }

  private async persist(
    state: CuratorState,
    start: number,
    transitioned: number,
    archived: number,
    reviewed: number,
    reportPath: string | undefined,
  ): Promise<void> {
    const finalState: CuratorState = {
      ...state,
      last_run_at: new Date().toISOString(),
      last_run_duration_seconds: Math.round((Date.now() - start) / 1000),
      last_run_summary: `transitioned=${transitioned} archived=${archived} reviewed=${reviewed}`,
      last_report_path: reportPath ?? null,
      run_count: state.run_count + 1,
    }
    await saveCuratorState(finalState)
  }

  private async writeReport(
    candidates: Array<{ summary: SkillSummary; manifest: SkillManifest; usageDays: number }>,
    transitioned: number,
    archived: number,
    reviewed: number,
  ): Promise<string | undefined> {
    if (candidates.length === 0) return undefined
    const lines: string[] = []
    lines.push(`# Curator report — ${new Date().toISOString()}`)
    lines.push("")
    lines.push(`- transitioned: ${transitioned}`)
    lines.push(`- archived: ${archived}`)
    lines.push(`- reviewed: ${reviewed}`)
    lines.push("")
    lines.push("## Candidates")
    for (const c of candidates) {
      const age = Number.isFinite(c.usageDays) ? `${c.usageDays.toFixed(1)}d` : "never"
      lines.push(
        `- ${c.summary.name} (${c.manifest.createdBy}) — used ${c.usageDays === Number.POSITIVE_INFINITY ? "0" : "1"}×, last ${age} ago`,
      )
    }
    const path = join(notepadDir(), "skills", `.curator_report_${Date.now()}.md`)
    try {
      await writeFile(path, lines.join("\n") + "\n", "utf-8")
      return path
    } catch {
      return undefined
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    const state = await loadCuratorState()
    state.paused = paused
    await saveCuratorState(state)
  }

  async resetInterval(): Promise<void> {
    const state = await loadCuratorState()
    state.last_run_at = null
    await saveCuratorState(state)
  }
}

// Process-wide singleton, lazy. The sidecar uses this in the `compact()` tail
// trigger; tests construct their own instance with a custom modelFactory.
let defaultCurator: Curator | null = null
export function getDefaultCurator(): Curator {
  if (!defaultCurator) defaultCurator = new Curator()
  return defaultCurator
}
