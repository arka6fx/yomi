// Per-skill usage telemetry. Mirrors Hermes' ~/.hermes/skills/.usage.json —
// small sidecar file, one entry per skill, written lazily. Used by the
// curator to derive lifecycle state and by `skill_list` to surface the last
// activity timestamp.

import { mkdir, readFile, writeFile, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { notepadDir } from "../../memory/loader.js"
import type { SkillLifecycleState } from "./skill-types.js"

export interface SkillUsageRecord {
  // Number of times the skill was loaded via `skill_view`.
  use_count: number
  // Number of times a supporting file was loaded.
  view_count: number
  // ISO timestamp of the most recent view / file-read.
  last_activity_at: string | null
  // Lifecycle state, derived from last_activity_at. The curator is the only
  // writer of this field.
  state: SkillLifecycleState
  // Mirrored from the manifest so the curator doesn't need to read every
  // SKILL.md just to decide whether to skip a pinned skill.
  pinned: boolean
}

export type SkillUsageMap = Record<string, SkillUsageRecord>

const DEFAULT_RECORD: SkillUsageRecord = {
  use_count: 0,
  view_count: 0,
  last_activity_at: null,
  state: "active",
  pinned: false,
}

function usageFilePath(): string {
  return join(notepadDir(), "skills", ".usage.json")
}

export function emptyRecord(): SkillUsageRecord {
  return { ...DEFAULT_RECORD }
}

async function atomicWriteJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8")
  await rename(tmp, path)
}

export async function loadUsage(): Promise<SkillUsageMap> {
  const path = usageFilePath()
  try {
    const raw = await readFile(path, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: SkillUsageMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue
      const r = v as Partial<SkillUsageRecord>
      out[k] = {
        use_count: typeof r.use_count === "number" ? r.use_count : 0,
        view_count: typeof r.view_count === "number" ? r.view_count : 0,
        last_activity_at: typeof r.last_activity_at === "string" ? r.last_activity_at : null,
        state:
          r.state === "active" || r.state === "stale" || r.state === "archived"
            ? r.state
            : "active",
        pinned: r.pinned === true,
      }
    }
    return out
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
    // Corrupt JSON: start fresh rather than crash. The next write will
    // overwrite the file atomically.
    return {}
  }
}

async function saveUsage(map: SkillUsageMap): Promise<void> {
  await atomicWriteJson(usageFilePath(), map)
}

export async function getUsage(name: string): Promise<SkillUsageRecord> {
  const map = await loadUsage()
  return map[name] ?? emptyRecord()
}

// Increment `skill_view` usage. Pins the record when the skill is pinned so
// the curator can fast-skip without re-reading the manifest.
export async function recordSkillView(
  name: string,
  opts: { pinned?: boolean } = {},
): Promise<SkillUsageRecord> {
  const map = await loadUsage()
  const existing = map[name] ?? emptyRecord()
  const next: SkillUsageRecord = {
    ...existing,
    use_count: existing.use_count + 1,
    last_activity_at: new Date().toISOString(),
    state: "active", // any use resets to active
    pinned: opts.pinned ?? existing.pinned,
  }
  map[name] = next
  await saveUsage(map)
  return next
}

// Increment `skill_read_file` view count. Same telemetry bucket as a view —
// a file read means the skill was actively used.
export async function recordSkillFileView(name: string): Promise<SkillUsageRecord> {
  const map = await loadUsage()
  const existing = map[name] ?? emptyRecord()
  const next: SkillUsageRecord = {
    ...existing,
    view_count: existing.view_count + 1,
    last_activity_at: new Date().toISOString(),
    state: "active",
    pinned: existing.pinned,
  }
  map[name] = next
  await saveUsage(map)
  return next
}

// Curator-only: overwrite the `state` field for a single skill (typically to
// "stale" or "archived" during a lifecycle pass). Does not touch other
// counters — preserving them keeps the next `recordSkillView` idempotent.
export async function setSkillState(
  name: string,
  state: SkillLifecycleState,
): Promise<SkillUsageRecord> {
  const map = await loadUsage()
  const existing = map[name] ?? emptyRecord()
  const next: SkillUsageRecord = { ...existing, state }
  map[name] = next
  await saveUsage(map)
  return next
}

// Curator-only: mirror the manifest's pinned flag into the usage record so
// `loadUsage()` is sufficient for the curator to skip pinned skills without
// re-reading the manifest.
export async function setSkillPinned(name: string, pinned: boolean): Promise<SkillUsageRecord> {
  const map = await loadUsage()
  const existing = map[name] ?? emptyRecord()
  const next: SkillUsageRecord = { ...existing, pinned }
  map[name] = next
  await saveUsage(map)
  return next
}
