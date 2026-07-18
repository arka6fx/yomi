# Capability-based security model for plugin and automation code

Status: accepted

## Context

Yomi's gateway runner currently trusts all connector tool code equally — every
tool in `ConnectorDef.tools()` is treated as yomi-core code and runs with full
privileges. As we add third-party plugins (browser automation, custom
connectors, skill-marketplace code), that trust model breaks: plugin code
should only access the resources it declared it needs, not everything the user
has connected.

The existing approval system (`gateWrite`) handles the "user said yes or no"
question for individual write actions. Capabilities answer a different question:
"does this caller have permission to even attempt this kind of operation?"

## Decision

Adopt a flat capability model with three concepts: **resources**, **actions**,
and **scopes**.

### Resources

The things a caller can interact with:

| Resource    | What it covers                                              |
|-------------|-------------------------------------------------------------|
| `memory`    | Memory entry CRUD and search                                |
| `schedule`  | Schedule CRUD                                               |
| `connector` | Invoking connected-service tools (Gmail, Calendar, etc.)    |
| `agent`     | Running the full yomi agent loop                            |
| `profile`   | Reading the user's profile and preferences                  |
| `filesystem`| Reading or writing local files (future browser-automation)  |

### Actions

What a caller can do to a resource:

- `read` — view, list, query (no side effects)
- `write` — create, update (side effects, user approval may still apply)
- `delete` — remove permanently
- `execute` — run / invoke (used for `agent` and some `connector` actions)

### Scopes

A scope is a `resource:action` pair expressed as a string:

```
memory:read
memory:write
schedule:read
schedule:write
connector:read
connector:execute
agent:execute
profile:read
filesystem:read
filesystem:write
```

Wildcards are supported:
- `memory:*` — all actions on memory
- `*:*` — all resources and actions (reserved for core/internal callers)

### Capability manifest

Code that needs access declares what it requires **and** what it can
optionally use:

```typescript
interface CapabilityManifest {
  required: string[]   // scopes — caller won't function without these
  optional: string[]   // scopes — caller degrades gracefully if absent
}
```

### Trust boundaries

Three tiers, determined by how the code is loaded:

| Boundary         | Source               | Capability resolution          |
|------------------|----------------------|--------------------------------|
| `core`           | Built into yomi-core | Full trust (`*:*` implicitly)  |
| `plugin`         | Registered plugin    | `CapabilityManifest` checked   |
| `external`       | MCP / API call       | Authenticated caller's scopes  |

### Enforcement model

Capability enforcement is additive to the existing approval gating:

1. **Capability check** — does the caller have `resource:action`? (before execution)
2. **Approval gate** — does the user need to approve? (for `write`/`send`/etc. risk levels)

Both must pass. Failure at (1) returns a denial immediately. Failure at (2)
queues a pending action.

## Considered options

- **RBAC (role-based)**: Map each caller to a role (admin, user, plugin). Roles
  are simpler to assign but coarser — you can't say "plugin X can read memory
  but plugin Y can write it" without adding more roles. Scopes give finer
  control at the same complexity cost.

- **OAuth-style scopes only, no manifest**: Require every caller to
  pre-configure its scopes in a DB row. More secure (explicit per-caller config)
  but higher friction for plugin developers. The manifest approach lets plugins
  self-describe and users approve or deny the bundle.

- **Object-capability model (ocap)**: Pass capability references at
  construction time rather than checking strings at runtime. Purer security
  model but harder to implement in a plugin registry where capabilities are
  loaded from a DB row. The flat string model is a pragmatic simplification.

## Consequences

- Every caller site (MCP server handler, plugin executor, agent loop) must
  carry a resolved capability set user-side.
- The capability check becomes a single `CapabilityEnforcer` service that
  any tool dispatch path calls before execution.
- Existing connector tools (Gmail, Calendar, etc.) run at `core` trust —
  no capability changes needed until they're exposed via a plugin boundary.
- The manifest+approval pattern mirrors mobile OS permission models, which
  users are familiar with.
- New resources and actions can be added without changing the enforcement
  layer — just the vocabulary.
