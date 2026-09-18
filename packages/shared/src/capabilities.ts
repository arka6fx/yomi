// Capability vocabulary + enforcement (ADR-0005, CONTEXT.md "Capability model").
// Pure so both the backend MCP server and agent-core connector dispatch share it.

export const CAPABILITY_RESOURCES = [
  "memory",
  "schedule",
  "connector",
  "agent",
  "profile",
  "filesystem",
] as const
export type CapabilityResource = (typeof CAPABILITY_RESOURCES)[number]

export const CAPABILITY_ACTIONS = ["read", "write", "delete", "execute"] as const
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number]

// A scope is a `resource:action` string; wildcards ("memory:*", "*:*") are allowed in a
// granted scope only — a required scope is always concrete.
export type Scope = string
export type CapabilitySet = readonly Scope[]

// Default scopes for an authenticated external (MCP/API) caller; deliberately withholds
// agent:execute, which is granted explicitly where the full agent loop is exposed.
export const EXTERNAL_DEFAULT_CAPABILITIES: CapabilitySet = [
  "memory:*",
  "schedule:*",
  "connector:*",
  "profile:read",
]

// Scopes for an authenticated external caller at a surface that exposes the full agent
// loop (e.g. the `run_yomi_agent` MCP tool). Same trust boundary as
// EXTERNAL_DEFAULT_CAPABILITIES, plus agent:execute.
export const EXTERNAL_AGENT_CAPABILITIES: CapabilitySet = [
  ...EXTERNAL_DEFAULT_CAPABILITIES,
  "agent:execute",
]

// Does a granted scope satisfy a required one? "*" matches on either side.
export function scopeGrants(granted: Scope, required: Scope): boolean {
  const [gr, ga] = granted.split(":")
  const [rr, ra] = required.split(":")
  return (gr === "*" || gr === rr) && (ga === "*" || ga === ra)
}

export function hasCapability(set: CapabilitySet, required: Scope): boolean {
  return set.some((granted) => scopeGrants(granted, required))
}

export function denialMessage(required: Scope): string {
  return `Capability denied: this action requires "${required}", which the caller has not been granted.`
}

export type CapabilityCheck =
  { allowed: true } | { allowed: false; missing: Scope; message: string }

// What a plugin (or any registered caller) declares it needs to operate.
// `required` must all be granted or the caller cannot run; `optional` degrade
// gracefully when absent. `permissions` is a free-form list of non-scope grants
// (e.g. provider keys) surfaced to the user at install time. (ADR-0005.)
export interface CapabilityManifest {
  required: Scope[]
  optional: Scope[]
  permissions: string[]
}

// Result of comparing a manifest against a granted capability set.
export interface ManifestSatisfaction {
  satisfied: boolean // every required scope is covered by the grant
  missing: Scope[] // required scopes the grant does not cover
  grantedOptional: Scope[] // optional scopes the grant does cover
  missingOptional: Scope[] // optional scopes the grant does not cover
}

// Pure comparison of a plugin's declared capability requirements against a
// user-granted capability set — the query side of the capability system.
export function evaluateManifest(
  manifest: CapabilityManifest,
  granted: CapabilitySet,
): ManifestSatisfaction {
  const missing = manifest.required.filter((scope) => !hasCapability(granted, scope))
  const grantedOptional = manifest.optional.filter((scope) => hasCapability(granted, scope))
  const missingOptional = manifest.optional.filter((scope) => !hasCapability(granted, scope))
  return {
    satisfied: missing.length === 0,
    missing,
    grantedOptional,
    missingOptional,
  }
}

// Checks a caller's granted scopes against a required `resource:action` before a tool
// runs — additive to the approval gate, which still applies afterwards for risky writes.
export class CapabilityEnforcer {
  constructor(private readonly granted: CapabilitySet) {}

  allows(required: Scope): boolean {
    return hasCapability(this.granted, required)
  }

  check(required: Scope): CapabilityCheck {
    return this.allows(required)
      ? { allowed: true }
      : { allowed: false, missing: required, message: denialMessage(required) }
  }
}
