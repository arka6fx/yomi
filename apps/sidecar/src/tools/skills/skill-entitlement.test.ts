import { describe, expect, it } from "bun:test"
import {
  canReadSkill,
  checkSkillWriteAccess,
  isReadOnlyPlan,
  planLimitsHelpUrl,
  skillLimitForPlan,
} from "./skill-entitlement.js"
import type { SkillManifest } from "./skill-types.js"

const agentManifest: SkillManifest = {
  name: "demo",
  description: "x",
  version: "1.0.0",
  createdBy: "agent",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
}

const bundledManifest: SkillManifest = { ...agentManifest, createdBy: "bundled" }

describe("canReadSkill", () => {
  it("returns true on every plan", () => {
    expect(canReadSkill("explore", agentManifest)).toBe(true)
    expect(canReadSkill("pro", agentManifest)).toBe(true)
    expect(canReadSkill("max", agentManifest)).toBe(true)
    expect(canReadSkill(undefined, agentManifest)).toBe(true)
  })
})

describe("checkSkillWriteAccess", () => {
  it("blocks all writes on explore", () => {
    expect(checkSkillWriteAccess("explore", null, 0, "create")).toEqual({
      ok: false,
      reason: expect.stringContaining("Explore is read-only") as unknown as string,
    })
  })

  it("blocks writes on bundled skills on every plan", () => {
    const r = checkSkillWriteAccess("pro", bundledManifest, 0, "edit")
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("bundled skills are read-only")
  })

  it("blocks create when at the plan limit", () => {
    expect(checkSkillWriteAccess("pro", null, 20, "create")).toEqual({
      ok: false,
      reason: expect.stringContaining("20/20") as unknown as string,
    })
  })

  it("allows create when under the plan limit", () => {
    expect(checkSkillWriteAccess("pro", null, 5, "create").ok).toBe(true)
    expect(checkSkillWriteAccess("max", null, 99, "create").ok).toBe(true)
  })

  it("allows edit/delete on a non-bundled skill on a paid plan", () => {
    expect(checkSkillWriteAccess("pro", agentManifest, 1, "edit").ok).toBe(true)
    expect(checkSkillWriteAccess("max", agentManifest, 1, "delete").ok).toBe(true)
    expect(checkSkillWriteAccess("pro", agentManifest, 1, "write_file").ok).toBe(true)
    expect(checkSkillWriteAccess("pro", agentManifest, 1, "remove_file").ok).toBe(true)
  })

  it("does not check the limit for non-create actions", () => {
    expect(checkSkillWriteAccess("pro", agentManifest, 999, "edit").ok).toBe(true)
  })

  it("plan limit check uses the manifest's provenance, not the action", () => {
    expect(checkSkillWriteAccess("pro", bundledManifest, 5, "delete")).toEqual({
      ok: false,
      reason: expect.stringContaining("bundled") as unknown as string,
    })
  })
})

describe("plan helpers", () => {
  it("skillLimitForPlan mirrors the spec table", () => {
    expect(skillLimitForPlan("explore")).toBe(0)
    expect(skillLimitForPlan("pro")).toBe(20)
    expect(skillLimitForPlan("max")).toBe(100)
  })

  it("isReadOnlyPlan is true only for explore and undefined", () => {
    expect(isReadOnlyPlan("explore")).toBe(true)
    expect(isReadOnlyPlan(undefined)).toBe(true)
    expect(isReadOnlyPlan("pro")).toBe(false)
    expect(isReadOnlyPlan("max")).toBe(false)
  })

  it("planLimitsHelpUrl is a stable URL", () => {
    expect(planLimitsHelpUrl()).toMatch(/^https?:\/\//)
  })
})
