import { describe, expect, it } from "bun:test"
import {
  canCreateSkill,
  canMutateSkill,
  isReadOnlyPlan,
  skillLimitForPlan,
  validateSkillBody,
  validateSkillDescription,
  validateSkillName,
  SkillValidationError,
  type SkillManifest,
} from "./skill-types.js"

const baseManifest: SkillManifest = {
  name: "demo-skill",
  description: "A demo skill for unit tests.",
  version: "1.0.0",
  createdBy: "agent",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
}

describe("validateSkillName", () => {
  it("accepts a simple lowercase name", () => {
    expect(validateSkillName("schedule-meeting")).toBe("schedule-meeting")
  })
  it("accepts digits and trailing hyphens", () => {
    expect(validateSkillName("v2-migration-2026")).toBe("v2-migration-2026")
  })
  it("rejects uppercase", () => {
    expect(() => validateSkillName("ScheduleMeeting")).toThrow(SkillValidationError)
  })
  it("rejects spaces", () => {
    expect(() => validateSkillName("my skill")).toThrow(SkillValidationError)
  })
  it("rejects empty", () => {
    expect(() => validateSkillName("")).toThrow(SkillValidationError)
  })
  it("rejects names longer than 64 chars", () => {
    const name = "a".repeat(65)
    expect(() => validateSkillName(name)).toThrow(SkillValidationError)
  })
  it("rejects names starting with a hyphen", () => {
    expect(() => validateSkillName("-leading")).toThrow(SkillValidationError)
  })
  it("trims surrounding whitespace before validating", () => {
    expect(validateSkillName("  schedule-meeting  ")).toBe("schedule-meeting")
  })
})

describe("validateSkillDescription", () => {
  it("trims and returns short descriptions", () => {
    expect(validateSkillDescription("  small desc  ")).toBe("small desc")
  })
  it("rejects empty", () => {
    expect(() => validateSkillDescription("   ")).toThrow(SkillValidationError)
  })
  it("rejects descriptions over 1024 chars", () => {
    expect(() => validateSkillDescription("x".repeat(1025))).toThrow(SkillValidationError)
  })
})

describe("validateSkillBody", () => {
  it("accepts normal bodies", () => {
    expect(validateSkillBody("# Hello\n\nbody")).toBe("# Hello\n\nbody")
  })
  it("rejects bodies over 64 KiB", () => {
    const body = "x".repeat(65 * 1024)
    expect(() => validateSkillBody(body)).toThrow(SkillValidationError)
  })
  it("rejects non-string bodies", () => {
    expect(() => validateSkillBody(123 as unknown as string)).toThrow(SkillValidationError)
  })
})

describe("skillLimitForPlan", () => {
  it("explore = 0 (read-only)", () => {
    expect(skillLimitForPlan("explore")).toBe(0)
  })
  it("pro = 20", () => {
    expect(skillLimitForPlan("pro")).toBe(20)
  })
  it("max = 100", () => {
    expect(skillLimitForPlan("max")).toBe(100)
  })
  it("no plan defaults to read-only", () => {
    expect(skillLimitForPlan(undefined)).toBe(0)
  })
})

describe("isReadOnlyPlan", () => {
  it("explore is read-only", () => {
    expect(isReadOnlyPlan("explore")).toBe(true)
  })
  it("pro is mutable", () => {
    expect(isReadOnlyPlan("pro")).toBe(false)
  })
  it("max is mutable", () => {
    expect(isReadOnlyPlan("max")).toBe(false)
  })
})

describe("canMutateSkill", () => {
  it("bundled skills are immutable on every plan", () => {
    const bundled = { ...baseManifest, createdBy: "bundled" as const }
    expect(canMutateSkill("pro", bundled)).toBe(false)
    expect(canMutateSkill("max", bundled)).toBe(false)
    expect(canMutateSkill("explore", bundled)).toBe(false)
  })
  it("agent skills are mutable on paid plans", () => {
    const agent = { ...baseManifest, createdBy: "agent" as const }
    expect(canMutateSkill("pro", agent)).toBe(true)
    expect(canMutateSkill("max", agent)).toBe(true)
  })
  it("agent skills are read-only on explore", () => {
    const agent = { ...baseManifest, createdBy: "agent" as const }
    expect(canMutateSkill("explore", agent)).toBe(false)
  })
})

describe("canCreateSkill", () => {
  it("returns false on read-only plans regardless of count", () => {
    expect(canCreateSkill("explore", 0)).toBe(false)
  })
  it("returns true when under the limit", () => {
    expect(canCreateSkill("pro", 19)).toBe(true)
  })
  it("returns false at the limit", () => {
    expect(canCreateSkill("pro", 20)).toBe(false)
  })
  it("returns false above the limit", () => {
    expect(canCreateSkill("max", 100)).toBe(false)
  })
})
