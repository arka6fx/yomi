// Plan-based gates for skill reads and writes. Encapsulates the plan →
// limit matrix and the read-only logic so the tools layer can ask a single
// function instead of duplicating the spec table.

import type { Plan } from "@yomi/shared"
import { skillLimitForPlan, isReadOnlyPlan, canCreateSkill, canMutateSkill } from "./skill-types.js"
import type { SkillManifest } from "./skill-types.js"

export interface SkillWriteDecision {
  ok: boolean
  reason?: string
}

export function planLimitsHelpUrl(): string {
  return "https://yomi.example.com/upgrade"
}

export function canReadSkill(_plan: Plan | undefined, _manifest: SkillManifest): boolean {
  // All plans can read skills. The bundled/user distinction is captured at
  // the list layer (Explore sees bundled only, but read tools don't filter
  // by provenance — the list does).
  return true
}

// Returns null if the action is allowed, otherwise a human-readable reason.
export function checkSkillWriteAccess(
  plan: Plan | undefined,
  manifest: SkillManifest | null,
  currentActiveCount: number,
  action: "create" | "edit" | "delete" | "write_file" | "remove_file",
): SkillWriteDecision {
  if (isReadOnlyPlan(plan)) {
    return {
      ok: false,
      reason: `skill ${action} requires a paid plan (Explore is read-only). Upgrade at ${planLimitsHelpUrl()}.`,
    }
  }
  if (manifest && !canMutateSkill(plan, manifest)) {
    return {
      ok: false,
      reason: `bundled skills are read-only on every plan`,
    }
  }
  if (action === "create" && !canCreateSkill(plan, currentActiveCount)) {
    const limit = skillLimitForPlan(plan)
    return {
      ok: false,
      reason: `skill limit reached for this plan (${currentActiveCount}/${limit})`,
    }
  }
  return { ok: true }
}

export { skillLimitForPlan, isReadOnlyPlan, canCreateSkill, canMutateSkill }
