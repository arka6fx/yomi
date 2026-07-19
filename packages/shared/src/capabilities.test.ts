import { describe, it, expect } from "bun:test"
import {
  CAPABILITY_RESOURCES,
  CAPABILITY_ACTIONS,
  scopeGrants,
  hasCapability,
  CapabilityEnforcer,
  EXTERNAL_DEFAULT_CAPABILITIES,
  EXTERNAL_AGENT_CAPABILITIES,
  evaluateManifest,
} from "./capabilities.js"

describe("scopeGrants", () => {
  it("matches an exact scope", () => {
    expect(scopeGrants("memory:read", "memory:read")).toBe(true)
  })

  it("does not match a different action on the same resource", () => {
    expect(scopeGrants("memory:read", "memory:write")).toBe(false)
  })

  it("does not match a different resource", () => {
    expect(scopeGrants("memory:read", "schedule:read")).toBe(false)
  })

  it("honors an action wildcard", () => {
    expect(scopeGrants("memory:*", "memory:write")).toBe(true)
    expect(scopeGrants("memory:*", "schedule:write")).toBe(false)
  })

  it("honors a full wildcard", () => {
    expect(scopeGrants("*:*", "connector:execute")).toBe(true)
    expect(scopeGrants("*:*", "anything:goes")).toBe(true)
  })
})

describe("hasCapability", () => {
  it("is true when any granted scope covers the requirement", () => {
    expect(hasCapability(["memory:read", "schedule:*"], "schedule:write")).toBe(true)
  })

  it("is false when no granted scope covers the requirement", () => {
    expect(hasCapability(["memory:read", "schedule:read"], "memory:write")).toBe(false)
  })

  it("is false for an empty set", () => {
    expect(hasCapability([], "memory:read")).toBe(false)
  })
})

describe("CapabilityEnforcer", () => {
  it("allows a granted scope", () => {
    const enforcer = new CapabilityEnforcer(["memory:*"])
    expect(enforcer.allows("memory:write")).toBe(true)
  })

  it("check() returns a denial naming the missing scope", () => {
    const enforcer = new CapabilityEnforcer(["memory:read"])
    const result = enforcer.check("memory:write")
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.missing).toBe("memory:write")
      expect(result.message).toContain("memory:write")
    }
  })

  it("check() returns allowed for a granted scope", () => {
    const enforcer = new CapabilityEnforcer(["memory:read"])
    expect(enforcer.check("memory:read").allowed).toBe(true)
  })

  it("allows a full wildcard against any scope", () => {
    const enforcer = new CapabilityEnforcer(["*:*"])
    expect(enforcer.allows("filesystem:write")).toBe(true)
  })
})

describe("EXTERNAL_DEFAULT_CAPABILITIES", () => {
  it("covers every current MCP tool scope", () => {
    const enforcer = new CapabilityEnforcer(EXTERNAL_DEFAULT_CAPABILITIES)
    for (const scope of [
      "memory:read",
      "memory:write",
      "memory:delete",
      "schedule:read",
      "schedule:write",
      "schedule:delete",
      "connector:execute",
    ]) {
      expect(enforcer.allows(scope)).toBe(true)
    }
  })

  it("does not implicitly grant the agent loop", () => {
    const enforcer = new CapabilityEnforcer(EXTERNAL_DEFAULT_CAPABILITIES)
    expect(enforcer.allows("agent:execute")).toBe(false)
  })
})

describe("EXTERNAL_AGENT_CAPABILITIES", () => {
  it("grants everything EXTERNAL_DEFAULT_CAPABILITIES grants, plus agent:execute", () => {
    const enforcer = new CapabilityEnforcer(EXTERNAL_AGENT_CAPABILITIES)
    for (const scope of [
      "memory:read",
      "memory:write",
      "memory:delete",
      "schedule:read",
      "schedule:write",
      "schedule:delete",
      "connector:execute",
      "agent:execute",
    ]) {
      expect(enforcer.allows(scope)).toBe(true)
    }
  })
})

describe("evaluateManifest", () => {
  it("is satisfied when every required scope is granted", () => {
    const result = evaluateManifest(
      { required: ["memory:read", "connector:execute"], optional: [], permissions: [] },
      ["memory:*", "connector:*"],
    )
    expect(result.satisfied).toBe(true)
    expect(result.missing).toEqual([])
  })

  it("is unsatisfied and lists every missing required scope", () => {
    const result = evaluateManifest(
      { required: ["memory:read", "memory:write", "agent:execute"], optional: [], permissions: [] },
      ["memory:read"],
    )
    expect(result.satisfied).toBe(false)
    expect(result.missing).toEqual(["memory:write", "agent:execute"])
  })

  it("reports which optional scopes are granted without affecting satisfaction", () => {
    const result = evaluateManifest(
      { required: ["memory:read"], optional: ["schedule:read", "filesystem:write"], permissions: [] },
      ["memory:read", "schedule:read"],
    )
    expect(result.satisfied).toBe(true)
    expect(result.grantedOptional).toEqual(["schedule:read"])
    expect(result.missingOptional).toEqual(["filesystem:write"])
  })

  it("is satisfied for an empty required list", () => {
    const result = evaluateManifest({ required: [], optional: [], permissions: [] }, [])
    expect(result.satisfied).toBe(true)
    expect(result.missing).toEqual([])
  })
})

describe("vocabulary", () => {
  it("exposes the ADR-0005 resources and actions", () => {
    expect(CAPABILITY_RESOURCES).toContain("memory")
    expect(CAPABILITY_RESOURCES).toContain("connector")
    expect(CAPABILITY_ACTIONS).toEqual(["read", "write", "delete", "execute"])
  })
})
