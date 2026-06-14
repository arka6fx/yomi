# Connector Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last live UIA import from the build and wire all existing ConnectorDef tools (Notion, GitHub, Google Calendar, Drive, Slack, Linear, Postgres, MySQL, Discord) into the agent tool set.

**Architecture:** Three isolated file changes: (1) stub `native.ts` so no code imports UIA anymore, (2) spread `createIntegrationTools()` + `getConnectorRegistry().getAllDefTools()` inside `createAgentTools()`, (3) update `apiProvider.diagnostics()` to surface actually-connected integrations. The ConnectorRegistry is a singleton initialized before any agent call, so the tools it returns reflect the current user's connected providers.

**Tech Stack:** Bun, `bun:test`, AI SDK `ToolSet`, `ConnectorRegistry` from `@yomi/agent-core`

---

## File Map

| File | Action | Why |
|---|---|---|
| `apps/sidecar/src/automation/providers/native.ts` | Replace | Remove UIA import — only live dependency on `uia/` |
| `apps/sidecar/src/automation/providers/health.test.ts` | Modify | Update native provider tests to match stub interface |
| `apps/sidecar/src/tools/index.ts` | Modify | Spread connector tools into `createAgentTools()` |
| `apps/sidecar/src/tools/wireup.test.ts` | Modify | Add test: connector tools appear when registry has them |
| `apps/sidecar/src/automation/providers/api.ts` | Replace | Report actual connected integrations in diagnostics |

---

## Task 1: Stub out native.ts

**Files:**
- Replace: `apps/sidecar/src/automation/providers/native.ts`
- Modify: `apps/sidecar/src/automation/providers/health.test.ts`

- [ ] **Step 1: Update the native provider tests to match the stub**

The existing tests call `createNativeProvider(port)` with a fake `UiaPort`. After stubbing, the provider is a hardcoded constant — update the native provider describe block so it tests the stub's fixed return values instead.

Open `apps/sidecar/src/automation/providers/health.test.ts` and replace the `"native provider health"` describe block:

```ts
// BEFORE — remove this entire describe block:
describe("native provider health", () => {
  it("reports healthy on Windows when the helper responds; gates off Windows", async () => { ... })
  it("reports unhealthy when the helper is unreachable on Windows", async () => { ... })
  it("always reports a platform in diagnostics", async () => { ... })
})
```

```ts
// AFTER — replace with:
import { nativeProvider } from "./native.js"

describe("native provider health", () => {
  it("is always unavailable (desktop automation not shipping)", async () => {
    const health = await nativeProvider.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.detail).toContain("not available")
  })

  it("diagnostics report available: false", async () => {
    const diag = await nativeProvider.diagnostics()
    expect(diag.available).toBe(false)
  })
})
```

Also remove the now-unused imports at the top of the file:
```ts
// Remove these two imports:
import { createNativeProvider } from "./native.js"
import type { UiaPort } from "./types.js"
```

- [ ] **Step 2: Run the test to verify it fails (nativeProvider not yet stubbed)**

```
bun test apps/sidecar/src/automation/providers/health.test.ts
```

Expected: The native provider tests fail because `nativeProvider` is still the old factory export. Workflow provider tests still pass.

- [ ] **Step 3: Replace native.ts with the stub**

Overwrite `apps/sidecar/src/automation/providers/native.ts` with:

```ts
// Desktop automation not shipping. See AGENTS.md.
import type { Provider } from "./types.js"

export const nativeProvider: Provider = {
  id: "native",
  label: "Native Automation",
  healthCheck: async () => ({ ok: false, detail: "native automation not available" }),
  diagnostics: async () => ({ available: false }),
  repair: async () => ({ ok: false, detail: "native automation not available" }),
}
```

- [ ] **Step 4: Run tests — all should pass**

```
bun test apps/sidecar/src/automation/providers/health.test.ts
```

Expected: All tests pass. No UIA import in the build.

- [ ] **Step 5: Commit**

```
git add apps/sidecar/src/automation/providers/native.ts apps/sidecar/src/automation/providers/health.test.ts
git commit -m "refactor: stub out native provider, remove uia import"
```

---

## Task 2: Wire connector tools into createAgentTools

**Files:**
- Modify: `apps/sidecar/src/tools/index.ts`
- Modify: `apps/sidecar/src/tools/wireup.test.ts`

- [ ] **Step 1: Write a failing test for connector tool injection**

Open `apps/sidecar/src/tools/wireup.test.ts`. After the existing imports at the top of the file, add this import:

```ts
import { ConnectorRegistry } from "@yomi/agent-core"
```

Then add a new describe block at the bottom of the file (after all existing describes):

```ts
describe("connector tools are wired into createAgentTools", () => {
  it("includes def tools from the registry when a connector is connected", () => {
    // Monkey-patch the singleton registry with a fake that returns one known tool
    const reg = (await import("../connectors/registry.js")).getConnectorRegistry()
    const fakeToolSet = { "notion.search": { description: "search notion", parameters: {}, execute: async () => ({}) } }
    const original = reg.getAllDefTools.bind(reg)
    reg.getAllDefTools = () => fakeToolSet

    try {
      const tools: Record<string, unknown> = createAgentTools()
      expect(tools["notion.search"]).toBeDefined()
    } finally {
      reg.getAllDefTools = original
    }
  })

  it("includes legacy integration tools (gmail)", () => {
    const tools: Record<string, unknown> = createAgentTools()
    expect(tools["gmail.searchEmails"]).toBeDefined()
    expect(tools["gmail.sendEmail"]).toBeDefined()
  })
})
```

Note: `bun:test` does not support top-level `await` in `describe` blocks — move the `await import` inside the `it` callback. Rewrite the first test as:

```ts
describe("connector tools are wired into createAgentTools", () => {
  it("includes def tools from the registry when a connector is connected", async () => {
    const { getConnectorRegistry } = await import("../connectors/registry.js")
    const reg = getConnectorRegistry()
    const fakeToolSet = { "notion.search": { description: "search notion", parameters: {}, execute: async () => ({}) } }
    const original = reg.getAllDefTools.bind(reg)
    reg.getAllDefTools = () => fakeToolSet as never

    try {
      const tools: Record<string, unknown> = createAgentTools()
      expect(tools["notion.search"]).toBeDefined()
    } finally {
      reg.getAllDefTools = original
    }
  })

  it("includes legacy integration tools (gmail)", () => {
    const tools: Record<string, unknown> = createAgentTools()
    expect(tools["gmail.searchEmails"]).toBeDefined()
    expect(tools["gmail.sendEmail"]).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
bun test apps/sidecar/src/tools/wireup.test.ts
```

Expected: The two new tests fail — `gmail.searchEmails` and `notion.search` are not in the tool set yet.

- [ ] **Step 3: Add connector tools to createAgentTools in tools/index.ts**

Open `apps/sidecar/src/tools/index.ts`. Add two imports after the existing imports:

```ts
import { createIntegrationTools } from "./integrations.js"
import { getConnectorRegistry } from "../connectors/registry.js"
```

Inside `createAgentTools()`, add the two spreads before `...getDefaultPluginManager().getTools()`:

```ts
export function createAgentTools(ctx: AgentToolsContext = {}) {
  return {
    ...createMemoryTools(),
    ...createSystemTools(ctx),
    ...createWebTools(),
    ...createSkillTools({ plan: ctx.plan }),
    ...createDelegateTaskTool({ plan: ctx.plan }),
    ...createCronJobTool({ plan: ctx.plan }),
    ...createMessagingTools(),
    ...createIntegrationTools(),
    ...getConnectorRegistry().getAllDefTools(),
    ...getDefaultPluginManager().getTools(),
  }
}
```

- [ ] **Step 4: Run tests — all should pass**

```
bun test apps/sidecar/src/tools/wireup.test.ts
```

Expected: All tests pass including the two new connector tests.

- [ ] **Step 5: Run the full sidecar test suite to catch regressions**

```
bun test apps/sidecar/src
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```
git add apps/sidecar/src/tools/index.ts apps/sidecar/src/tools/wireup.test.ts
git commit -m "feat: wire connector def tools into agent tool set"
```

---

## Task 3: Update apiProvider diagnostics

**Files:**
- Replace: `apps/sidecar/src/automation/providers/api.ts`
- Modify: `apps/sidecar/src/automation/providers/health.test.ts`

- [ ] **Step 1: Write a failing test for updated api provider diagnostics**

Open `apps/sidecar/src/automation/providers/health.test.ts`. Add a new describe block at the bottom:

```ts
import { apiProvider } from "./api.js"
import { getConnectorRegistry } from "../../connectors/registry.js"

describe("api provider health", () => {
  it("reports no integrations connected when registry is empty", async () => {
    const health = await apiProvider.healthCheck()
    expect(health.ok).toBe(true)
    expect(health.detail).toContain("no integrations")
  })

  it("diagnostics list connected provider ids", async () => {
    const reg = getConnectorRegistry()
    const original = reg.getConnected.bind(reg)
    reg.getConnected = () => ["notion", "github"]

    try {
      const diag = await apiProvider.diagnostics()
      expect(diag.integrations).toEqual(["notion", "github"])
    } finally {
      reg.getConnected = original
    }
  })

  it("healthCheck reports count when integrations are connected", async () => {
    const reg = getConnectorRegistry()
    const original = reg.getConnected.bind(reg)
    reg.getConnected = () => ["notion"]

    try {
      const health = await apiProvider.healthCheck()
      expect(health.ok).toBe(true)
      expect(health.detail).toContain("1 integration")
    } finally {
      reg.getConnected = original
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
bun test apps/sidecar/src/automation/providers/health.test.ts
```

Expected: The three new api provider tests fail — current `api.ts` always returns the placeholder text and an empty array.

- [ ] **Step 3: Replace api.ts with the real implementation**

Overwrite `apps/sidecar/src/automation/providers/api.ts` with:

```ts
import { getConnectorRegistry } from "../../connectors/registry.js"
import type { Provider } from "./types.js"

export const apiProvider: Provider = {
  id: "api",
  label: "API Provider",
  async healthCheck() {
    const connected = getConnectorRegistry().getConnected()
    return connected.length > 0
      ? { ok: true, detail: `${connected.length} integration(s) connected` }
      : { ok: true, detail: "no integrations connected" }
  },
  async diagnostics() {
    return { integrations: getConnectorRegistry().getConnected() }
  },
  async repair() {
    return { ok: true, detail: "nothing to repair" }
  },
}
```

- [ ] **Step 4: Run tests — all should pass**

```
bun test apps/sidecar/src/automation/providers/health.test.ts
```

Expected: All tests pass including the three new api provider tests.

- [ ] **Step 5: Run the full sidecar test suite**

```
bun test apps/sidecar/src
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```
git add apps/sidecar/src/automation/providers/api.ts apps/sidecar/src/automation/providers/health.test.ts
git commit -m "feat: api provider reports actual connected integrations"
```

---

## Self-Review

**Spec coverage:**
- ✅ Stub `native.ts` to remove UIA import — Task 1
- ✅ `uia/` files already dead (no changes needed) — confirmed in spec, no task needed
- ✅ Wire `createIntegrationTools()` + `getAllDefTools()` into `createAgentTools()` — Task 2
- ✅ Update `apiProvider.diagnostics()` to report real connected providers — Task 3

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**
- `nativeProvider` (stub) satisfies `Provider` interface — `id`, `label`, `healthCheck`, `diagnostics`, `repair` all present
- `getAllDefTools()` returns `ToolSet` which spreads cleanly into the object literal
- `getConnected()` returns `string[]` — `diag.integrations` typed as `string[]` implicitly via the return
