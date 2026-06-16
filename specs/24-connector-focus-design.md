# Design: Comment out desktop/browser automation + wire connector tools

**Date:** 2026-06-15
**Status:** Approved

---

## Problem

Two issues to resolve in one pass:

1. `apps/sidecar/src/uia/` contains 24 files of active desktop-automation code (UIA
   client, Playwright browser layer, act-executor, recovery, procedural memory, etc.)
   that AGENTS.md says are removed and not shipping. Tool imports are already commented
   out so nothing calls this code, but the files are live and create noise, compile
   overhead, and maintenance surface.

2. `packages/agent-core/src/connectors/` has a complete `ConnectorDef`-based system
   with 11 connectors (Gmail, Google Calendar, Google Drive, GitHub, Notion, Slack,
   Linear ×2, Postgres, MySQL, Discord) whose tools are loaded by `ConnectorRegistry`
   but never injected into the agent tool set — so the agent cannot use any of them.

---

## Scope

### In scope
- Comment out all live code in `apps/sidecar/src/uia/`
- Stub `apps/sidecar/src/automation/providers/native.ts` (remove UIA import, return
  health stub)
- Inject `createIntegrationTools()` + `getConnectorRegistry().getAllDefTools()` into
  `createAgentTools()` in `apps/sidecar/src/tools/index.ts`
- Update `apps/sidecar/src/automation/providers/api.ts` diagnostics to report
  actually-connected providers

### Out of scope
- Adding new connectors
- Changes to `ConnectorRegistry`, `ConnectorDef`, connector implementations
- LangGraph graph, fast pipeline, harness, backend OAuth routes
- Landing page / dashboard UI

---

## Part 1 — Desktop & browser automation cleanup

### Files to comment out

Nothing imports from `uia/` — all callers were already commented out. The 24 files are
dead code. No need to wrap them; they don't compile into the binary.

The **one live dependency** is `automation/providers/native.ts` importing
`../../uia/client.js`. Replacing it with the stub below is the only file change needed
to fully sever UIA from the build.

**`apps/sidecar/src/uia/`** — no changes needed (already inert):
- `act-bus.ts`, `act-bus.test.ts`
- `act-executor.ts`
- `automation-harness.ts`, `automation-harness.test.ts`
- `browser-layer.ts`
- `client.ts`, `client.test.ts`
- `episodic-memory.ts`
- `event-recorder.ts`, `event-recorder.test.ts`
- `failure-artifacts.ts`, `failure-artifacts.test.ts`
- `failure-regression.test.ts`
- `knowledge-graph.ts`
- `modal-selector.ts`
- `procedural-memory.ts`
- `recovery.ts`, `recovery.test.ts`
- `safety.ts`, `safety.test.ts`
- `spec21-integration.test.ts`
- `vision-layer.ts`, `vision-layer.test.ts`

### `apps/sidecar/src/automation/providers/native.ts`

Replace with a stub that satisfies the `Provider` interface without importing from
`uia/client.ts`:

```ts
import type { Provider } from "./types.js"

export const nativeProvider: Provider = {
  id: "native",
  label: "Native Automation",
  healthCheck: async () => ({ ok: false, detail: "native automation not available" }),
  diagnostics: async () => ({ available: false }),
  repair: async () => ({ ok: false, detail: "native automation not available" }),
}
```

### Already done (no changes needed)
- `apps/sidecar/src/mcp/client.ts` — Playwright MCP, fully commented
- `apps/sidecar/src/automation/agents/browser.ts` — fully commented
- `apps/sidecar/src/automation/providers/browser.ts` — fully commented
- `apps/sidecar/src/tools/index.ts` — `createUiaAdvancedTools` import commented out
- `apps/sidecar/src/harness/tools.ts` — all UIA tools commented out of `AGENT_TOOLS`
- `apps/sidecar/src/automation/agents/registry.ts` — browser agent commented out

---

## Part 2 — Wire connector tools into the agent

### Change: `apps/sidecar/src/tools/index.ts`

Add two imports and spread both tool factories inside `createAgentTools()`:

```ts
import { createIntegrationTools } from "./integrations.js"
import { getConnectorRegistry } from "../connectors/registry.js"

export function createAgentTools(ctx: AgentToolsContext = {}) {
  return {
    ...createMemoryTools(),
    ...createSystemTools(ctx),
    ...createWebTools(),
    ...createSkillTools({ plan: ctx.plan }),
    ...createDelegateTaskTool({ plan: ctx.plan }),
    ...createCronJobTool({ plan: ctx.plan }),
    ...createMessagingTools(),
    ...createIntegrationTools(),                  // legacy Gmail connector
    ...getConnectorRegistry().getAllDefTools(),    // all ConnectorDef tools
    ...getDefaultPluginManager().getTools(),
  }
}
```

`getAllDefTools()` returns an empty `ToolSet` when no connectors are connected or the
registry hasn't been initialized, so this is safe in all code paths (fast pipeline,
legacy agent, LangGraph graph, tests).

### Change: `apps/sidecar/src/automation/providers/api.ts`

Update `diagnostics()` to reflect actual connected integrations:

```ts
import { getConnectorRegistry } from "../../connectors/registry.js"
import type { Provider } from "./types.js"

export const apiProvider: Provider = {
  id: "api",
  label: "API Provider",
  healthCheck: async () => {
    const connected = getConnectorRegistry().getConnected()
    return connected.length > 0
      ? { ok: true, detail: `${connected.length} integration(s) connected` }
      : { ok: true, detail: "no integrations connected" }
  },
  diagnostics: async () => ({
    integrations: getConnectorRegistry().getConnected(),
  }),
  repair: async () => ({ ok: true, detail: "nothing to repair" }),
}
```

---

## Data flow after the change

```
User request
  → initConnectorRegistry(userId)          ← already called before agent runs
  → ConnectorRegistry.refresh()            ← loads connected providers from backend
  → ConnectorRegistry.getAllDefTools()      ← returns merged ToolSet for connected providers
  → createAgentTools() spreads the tools   ← agent can now call notion.search, github.*, etc.
  → LangGraph execution node runs          ← tools available in the tool loop
```

---

## Testing

- Unit: `getConnectorRegistry().getAllDefTools()` returns `{}` when registry not init'd
  (already true by design — no new tests needed)
- Manual: connect Notion or GitHub in the dashboard, ask the agent to search Notion /
  list GitHub repos — tools should appear and execute

---

## Risk

Low. `getAllDefTools()` returns `{}` by default so the change is additive and safe in
every code path. The UIA comment-out is mechanical — nothing calls those files since
the imports were already commented out.
