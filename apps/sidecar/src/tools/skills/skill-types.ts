// Procedural-memory skill types. Skills are stored under ~/.yomi/skills/<name>/
// with a SKILL.md (YAML frontmatter + markdown body) and optional supporting
// files. They are the agent's procedural memory; memory.md / yomi.md remain
// declarative.

import type { Plan } from "@yomi/shared"

export type SkillProvenance = "agent" | "user" | "bundled"

export type SkillLifecycleState = "active" | "stale" | "archived"

// Mirrors Hermes' SKILL.md frontmatter — only the fields we actually validate.
// Frontmatter may carry other keys (tags, related_skills, etc.) which we read
// through the `metadata` passthrough.
export interface SkillManifest {
  name: string
  description: string
  version: string
  author?: string
  license?: string
  platforms?: string[]
  createdBy: SkillProvenance
  createdAt: string
  updatedAt: string
  pinned?: boolean
  metadata?: {
    yomi?: {
      tags?: string[]
      relatedSkills?: string[]
    }
  }
  // Anything else in the frontmatter is preserved verbatim so a round-trip
  // (read → write) doesn't drop fields the curator or a future stage cares
  // about.
  extra?: Record<string, unknown>
}

export interface SkillSummary {
  name: string
  description: string
  version: string
  createdBy: SkillProvenance
  pinned: boolean
  // Optional supporting file count — surfaced in the system-prompt index for
  // richer awareness.
  fileCount: number
  // Telemetry values, sourced from skill-usage.ts. May be null when the
  // telemetry file is missing or has no entry yet.
  lastActivityAt: string | null
  useCount: number
  viewCount: number
}

export interface SkillFull {
  manifest: SkillManifest
  body: string
  // Absolute path to the skill directory.
  path: string
  // Relative paths of every file under the skill directory (excludes SKILL.md).
  files: string[]
}

// Limits match the spec. Explore is read-only — the limit exists so a future
// plan upgrade UI has a sensible value to render.
export const SKILL_LIMITS: Record<NonNullable<Plan> | "default", number> = {
  explore: 0,
  pro: 20,
  max: 100,
  default: 0,
}

// 64 chars per spec, lowercase + hyphens. Anchored on the full string so a
// space or uppercase sneaks past validation.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_BODY_BYTES = 64 * 1024

export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillValidationError"
  }
}

export function validateSkillName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new SkillValidationError("skill name is required")
  if (!NAME_RE.test(trimmed)) {
    throw new SkillValidationError(
      `invalid skill name "${trimmed}": must match ${NAME_RE.source} (lowercase letters, digits, hyphens; max 64 chars; cannot start or end with hyphen)`,
    )
  }
  return trimmed
}

export function validateSkillDescription(description: string): string {
  const trimmed = description.trim()
  if (!trimmed) throw new SkillValidationError("skill description is required")
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new SkillValidationError(
      `skill description too long: ${trimmed.length} > ${MAX_DESCRIPTION_LENGTH} chars`,
    )
  }
  return trimmed
}

export function validateSkillBody(body: string): string {
  if (typeof body !== "string") {
    throw new SkillValidationError("skill body must be a string")
  }
  // Byte length, not char length, to keep the file under the 64 KiB ceiling
  // even with multi-byte chars.
  const bytes = Buffer.byteLength(body, "utf-8")
  if (bytes > MAX_BODY_BYTES) {
    throw new SkillValidationError(`skill body too large: ${bytes} > ${MAX_BODY_BYTES} bytes`)
  }
  return body
}

export function skillLimitForPlan(plan: Plan | undefined): number {
  return SKILL_LIMITS[plan ?? "default"]
}

export function isReadOnlyPlan(plan: Plan | undefined): boolean {
  return skillLimitForPlan(plan) === 0
}

// Bundled skills are immutable on every plan. User/agent skills are mutable
// on plans with a non-zero limit.
export function canMutateSkill(plan: Plan | undefined, manifest: SkillManifest): boolean {
  if (manifest.createdBy === "bundled") return false
  return !isReadOnlyPlan(plan)
}

export function canCreateSkill(plan: Plan | undefined, currentActiveCount: number): boolean {
  const limit = skillLimitForPlan(plan)
  if (limit === 0) return false
  return currentActiveCount < limit
}
