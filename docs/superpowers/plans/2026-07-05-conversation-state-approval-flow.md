# Conversation State, Approval Flow & Context Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Yomi's sidecar remember pending confirmations, execute approved actions from stored state (never re-planning), resolve conversational references ("it", "yes", "show me"), and inject active-entity context into every prompt.

**Architecture:** The sidecar already contains a complete but **unwired** `conversation/` module (`EntityStore`, `PendingActionManager`, `ReferenceResolver`, `workspace-mapper`) and the monorepo already has a **proven** approval pattern: `gateWrite()` in `packages/agent-core/src/connectors/connector-def.ts` queues writes through `ctx.createPendingAction` when the host supplies it (the backend/Telegram path does; the sidecar does not — that is root-cause #1). This plan (a) supplies `createPendingAction` from the sidecar so every connector write is structurally gated, (b) intercepts approval/rejection turns *before* intent routing and replays the stored tool call ungated (mirroring backend `replayConnectorTool`), (c) scopes conversation state per conversation key with JSON persistence under `~/.yomi/state/`, and (d) injects the conversation-state block into agent and fast prompts (root-cause #2: `setConversationStateBlock` currently has zero callers, so the `<conversation_state>` block is always empty).

**Tech Stack:** Bun, TypeScript, Hono, Vercel AI SDK (`ai` tool sets), `bun test`.

**Reference material:** Root `ref/` folder (gitignored) contains shallow clones of `openclaw/openclaw` (personal-assistant session/approval model), `ComposioHQ/composio` (tool registry + entity patterns), `supermemoryai/supermemory` (memory layering), `NousResearch/Hermes-Agent`, `nozomio-labs/nia`, and `pi`. The **primary** reference is in-repo: `apps/backend/src/services/pending-actions.ts` (DB-backed lifecycle + replay) and `apps/backend/src/gateway/gateway-runner.ts:211-302` (approval synonym handling). Per `specs/connectors/00-index.md`: "Tools that … mutate user data must require confirmation before the mutation. Prefer the shared pending-action gate where available."

## Global Constraints

- Runtime is Bun; run tests with `bun test <path>` from repo root; `bun run ci` must pass before handoff.
- Conventional commits: lowercase, no full stops, max 72 chars, no em-dashes.
- Commits: user granted a one-time exception (2026-07-05) — implementer subagents commit per task on `feat/conversation-state` only. Stage only the files your task touched (never `git add -A`; the working tree has unrelated dirty files). Main stays untouched; the user/opencode reviews and merges.
- No `as any` in non-test files; no multi-line docstrings; one-liner comments on non-obvious logic only; empty catches use `// ignore` or `// best-effort`.
- Never switch models mid-turn (AGENTS.md); approval interception is deterministic (no LLM call) so it cannot violate this.
- All connector tool keys use the `<family>-<verb>` naming from `packages/agent-core/src/connectors/*-def.ts` (e.g. `github-createOrUpdateFile`, `gmail-sendEmail`, `slack-sendMessage`) — the specs in `specs/connectors/*.md` list them per connector; never invent names.

---

### Task 1: Per-conversation state scoping + disk persistence

**Files:**
- Modify: `apps/sidecar/src/conversation/types.ts`
- Modify: `apps/sidecar/src/conversation/pending-action.ts`
- Modify: `apps/sidecar/src/conversation/conversation-state.ts`
- Create: `apps/sidecar/src/conversation/persistence.ts`
- Test: `apps/sidecar/src/conversation/persistence.test.ts`
- Modify: `apps/sidecar/src/conversation/pending-action.test.ts` (dedupe case)

**Interfaces:**
- Consumes: existing `PendingAction`, `TrackedEntity`, `ConversationTurn` types.
- Produces: `getConversationState(key?: string): ConversationState` (keyed, default `"desktop"`), `resetConversationState(key?: string)`, `PendingActionManager.create()` deduping same pending `toolName`, `serializeState(s): string` / `hydrateState(s, json): void` in `persistence.ts`, and `ConversationState.persistKey` triggering debounced saves to `~/.yomi/state/conversation-<key>.json`.

- [ ] **Step 1: Widen `PendingActionType` to tool-key strings**

`gateWrite` stores the raw tool key (`github-createOrUpdateFile`), not the spec's dotted names. In `types.ts` replace the closed union:

```ts
// Tool key of the gated call, e.g. "github-createOrUpdateFile", "gmail-sendEmail".
export type PendingActionType = string
```

Leave `PendingActionStatus`, synonym sets, and everything else unchanged.

- [ ] **Step 2: Write failing tests for dedupe + serialization**

Append to `pending-action.test.ts`:

```ts
it("dedupes a second pending action with the same toolName", () => {
  const a = manager.create({
    type: "github-createOrUpdateFile", title: "Create recursion.go",
    description: "d", toolName: "github-createOrUpdateFile",
    toolArguments: { path: "recursion.go" }, conversationSummary: "s",
  })
  const b = manager.create({
    type: "github-createOrUpdateFile", title: "Create recursion.go again",
    description: "d", toolName: "github-createOrUpdateFile",
    toolArguments: { path: "recursion.go" }, conversationSummary: "s",
  })
  expect(b.id).toBe(a.id)
  expect(manager.listPending()).toHaveLength(1)
})
```

Create `persistence.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { ConversationState } from "./conversation-state.js"
import { serializeState, hydrateState } from "./persistence.js"

describe("conversation persistence", () => {
  it("round-trips pending actions, entities, and turns", () => {
    const a = new ConversationState()
    a.pendingActions.create({
      type: "github-createOrUpdateFile", title: "Create recursion.go",
      description: "commit to main", toolName: "github-createOrUpdateFile",
      toolArguments: { owner: "u", repo: "golang-practice", path: "recursion.go" },
      conversationSummary: "user asked to create recursion.go",
    })
    a.registerEntity({
      type: "github_repo", title: "u/golang-practice", summary: "repo",
      metadata: { owner: "u", repo: "golang-practice", fullName: "u/golang-practice" },
    })
    a.addTurn({ role: "user", text: "create recursion.go", timestamp: new Date() })

    const b = new ConversationState()
    hydrateState(b, serializeState(a))

    const pending = b.pendingActions.getLatest()
    expect(pending?.toolName).toBe("github-createOrUpdateFile")
    expect(pending?.toolArguments).toEqual({ owner: "u", repo: "golang-practice", path: "recursion.go" })
    expect(b.entityStore.getActiveContext().currentRepo?.fullName).toBe("u/golang-practice")
    expect(b.turns).toHaveLength(1)
  })

  it("revives Date fields so expiry pruning still works", () => {
    const a = new ConversationState()
    a.pendingActions.create({
      type: "t", title: "t", description: "d", toolName: "t",
      toolArguments: {}, conversationSummary: "s",
    })
    const b = new ConversationState()
    hydrateState(b, serializeState(a))
    expect(b.pendingActions.getLatest()?.expiresAt).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test apps/sidecar/src/conversation/persistence.test.ts apps/sidecar/src/conversation/pending-action.test.ts`
Expected: FAIL — `serializeState` not found; dedupe test gets 2 pending actions.

- [ ] **Step 4: Implement dedupe + collision-safe ids in `pending-action.ts`**

Replace the counter id (persistence across restarts would collide `pa_1`):

```ts
function nextId(): string {
  return `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
```

At the top of `create()`, before building the action (mirrors backend `createPendingAction` dedupe):

```ts
this.pruneExpired()
const existing = this.actions.find(
  (a) => a.status === "pending" && a.toolName === input.toolName,
)
if (existing) return existing
```

Add serialization accessors at the end of the class:

```ts
snapshot(): PendingAction[] {
  return [...this.actions]
}

restore(actions: PendingAction[]): void {
  this.actions = actions
}
```

- [ ] **Step 5: Implement `persistence.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ConversationState } from "./conversation-state.js"
import type { PendingAction, TrackedEntity, ConversationTurn } from "./types.js"

const DATE_KEYS = new Set(["createdAt", "expiresAt", "timestamp"])

interface Snapshot {
  pendingActions: PendingAction[]
  entities: TrackedEntity[]
  turns: ConversationTurn[]
}

export function serializeState(state: ConversationState): string {
  const snap: Snapshot = {
    pendingActions: state.pendingActions.snapshot(),
    entities: state.entityStore.snapshot(),
    turns: state.turns.slice(-10),
  }
  return JSON.stringify(snap)
}

export function hydrateState(state: ConversationState, json: string): void {
  const snap = JSON.parse(json, (key, value) =>
    DATE_KEYS.has(key) && typeof value === "string" ? new Date(value) : value,
  ) as Snapshot
  state.pendingActions.restore(snap.pendingActions ?? [])
  state.entityStore.restore(snap.entities ?? [])
  state.turns = snap.turns ?? []
}

function stateDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
  return join(home, ".yomi", "state")
}

function stateFile(key: string): string {
  // Keys like "telegram:12345" must be filename-safe.
  return join(stateDir(), `conversation-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
}

export function saveStateToDisk(key: string, state: ConversationState): void {
  try {
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(stateFile(key), serializeState(state), "utf-8")
  } catch {
    // best-effort
  }
}

export function loadStateFromDisk(key: string, state: ConversationState): void {
  try {
    hydrateState(state, readFileSync(stateFile(key), "utf-8"))
  } catch {
    // ignore — first run or corrupt file starts fresh
  }
}
```

- [ ] **Step 6: Add `EntityStore.snapshot()/restore()`**

In `entity-store.ts` append to the class:

```ts
snapshot(): TrackedEntity[] {
  const out: TrackedEntity[] = []
  for (const e of this.entities.values()) out.push(e)
  return out.slice(-40)
}

restore(entities: TrackedEntity[]): void {
  this.clear()
  for (const e of entities) {
    this.entities.set(e.id, e)
    const existing = this.entityIndex.get(e.type) ?? []
    existing.unshift(e.id)
    this.entityIndex.set(e.type, existing)
    this.updateActiveContext(e)
  }
}
```

Note `restore` iterates in stored order so the *last* stored entity of each type wins `updateActiveContext` — `snapshot()` returns insertion order, which preserves recency. Also make `nextId` collision-safe, same pattern as pending actions: `` `ent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` ``.

- [ ] **Step 7: Key the singleton and auto-persist in `conversation-state.ts`**

Replace the singleton block at the bottom:

```ts
const _instances = new Map<string, ConversationState>()

export function getConversationState(key = "desktop"): ConversationState {
  let s = _instances.get(key)
  if (!s) {
    s = new ConversationState()
    loadStateFromDisk(key, s)
    s.persistKey = key
    _instances.set(key, s)
  }
  return s
}

export function resetConversationState(key?: string): void {
  if (key) _instances.delete(key)
  else _instances.clear()
}
```

Add to the class: `persistKey: string | null = null` and a save hook:

```ts
persist(): void {
  if (this.persistKey) saveStateToDisk(this.persistKey, this)
}
```

Call `this.persist()` at the end of `addTurn()` and `registerEntity()`, and in `handleApprovalStatus()` after a decision. Import `loadStateFromDisk`/`saveStateToDisk` from `./persistence.js` (circular-import safe: persistence imports only the type via `import type`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test apps/sidecar/src/conversation/`
Expected: all PASS (existing entity-store/reference tests must stay green).

- [ ] **Step 9: Commit checkpoint (hand off — do not run git commit)**

Files: the six above. Message: `feat: per-conversation state scoping with disk persistence`

---

### Task 2: Supply `createPendingAction` to the sidecar connector registry

The one-line root cause: `apps/sidecar/src/connectors/registry.ts:68-71` builds `ConnectorRegistry` with only `getAccessToken` + `listConnectedProviders`, so `gateWrite()` (connector-def.ts:105-122) sees no `ctx.createPendingAction` and executes writes immediately. The backend passes it (see `apps/backend/src/agent/run.ts:459`); the sidecar must too.

**Files:**
- Create: `apps/sidecar/src/conversation/active-conversation.ts`
- Modify: `apps/sidecar/src/connectors/registry.ts`
- Modify: `packages/agent-core/src/connectors/registry.ts` (add `getUserId()` accessor)
- Modify: `specs/connectors/00-index.md` (note sidecar now enforces the gate)
- Test: `apps/sidecar/src/conversation/active-conversation.test.ts`

**Interfaces:**
- Consumes: `getConversationState(key)` from Task 1; `ConnectorRegistryDeps.createPendingAction` (already typed in agent-core: `(input: { connector; action; risk; title; preview; confirmText?; payload }) => Promise<{ id: string; status: string; message: string }>`).
- Produces: `setActiveConversation(key: string)` / `getActiveConversation(): string`; a registry whose gated writes queue into the active conversation's `PendingActionManager`; `ConnectorRegistry.getUserId(): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "bun:test"
import { setActiveConversation, getActiveConversation, makeSidecarPendingActionDep } from "./active-conversation.js"
import { getConversationState, resetConversationState } from "./conversation-state.js"

describe("sidecar pending-action dep", () => {
  beforeEach(() => resetConversationState())

  it("queues a pending action in the active conversation and returns approval message", async () => {
    setActiveConversation("telegram:42")
    const dep = makeSidecarPendingActionDep()
    const res = await dep({
      connector: "github", action: "github-createOrUpdateFile", risk: "write",
      title: "Create recursion.go in u/golang-practice",
      preview: "path: recursion.go", payload: { owner: "u", repo: "golang-practice", path: "recursion.go", content: "x" },
    })
    expect(res.status).toBe("pending")
    expect(res.message).toContain("Approval required")
    const pending = getConversationState("telegram:42").pendingActions.getLatest()
    expect(pending?.toolName).toBe("github-createOrUpdateFile")
    expect(pending?.toolArguments).toEqual({ owner: "u", repo: "golang-practice", path: "recursion.go", content: "x" })
  })

  it("defaults active conversation to desktop", () => {
    resetConversationState()
    expect(getActiveConversation()).toBe("desktop")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/sidecar/src/conversation/active-conversation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `active-conversation.ts`**

```ts
import { getConversationState } from "./conversation-state.js"

// The sidecar is single-process; pipelines set the key at turn start so
// connector tools (built once per registry init) queue into the right chat.
let _activeKey = "desktop"

export function setActiveConversation(key: string): void {
  _activeKey = key
}

export function getActiveConversation(): string {
  return _activeKey
}

export type PendingActionDep = (input: {
  connector: string
  action: string
  risk: "write" | "send" | "paid" | "irreversible"
  title: string
  preview: string
  confirmText?: string
  payload: unknown
}) => Promise<{ id: string; status: string; message: string }>

export function makeSidecarPendingActionDep(): PendingActionDep {
  return async (input) => {
    const state = getConversationState(_activeKey)
    const action = state.pendingActions.create({
      type: input.action,
      title: input.title,
      description: input.preview,
      toolName: input.action,
      toolArguments: (input.payload ?? {}) as Record<string, unknown>,
      conversationSummary: input.title,
    })
    state.persist()
    return {
      id: action.id,
      status: action.status,
      message:
        `Approval required: ${input.title}. ${input.preview}. ` +
        `Ask the user to confirm — reply "yes" to approve or "no" to cancel. Do not retry the tool.`,
    }
  }
}
```

- [ ] **Step 4: Wire the dep into the sidecar registry shim**

In `apps/sidecar/src/connectors/registry.ts`, `getConnectorRegistry()`:

```ts
import { makeSidecarPendingActionDep } from "../conversation/active-conversation.js"

export function getConnectorRegistry(): ConnectorRegistry {
  if (!_registry) {
    _registry = new ConnectorRegistry({
      getAccessToken: makeTokenProvider(),
      listConnectedProviders: makeConnectedProvidersLister(),
      createPendingAction: makeSidecarPendingActionDep(),
    })
  }
  return _registry
}
```

- [ ] **Step 5: Add `getUserId()` to agent-core registry**

In `packages/agent-core/src/connectors/registry.ts`, after `init()`:

```ts
getUserId(): string | null {
  return this.userId
}
```

(Task 3's replay executor needs it to rebuild ungated tools.)

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test apps/sidecar/src/conversation/ && bun run --filter @yomi/agent-core typecheck` (or the repo's `bun run ci` typecheck step)
Expected: PASS.

- [ ] **Step 7: Update `specs/connectors/00-index.md`**

Under "Confirmation rule" append:

```markdown
The sidecar supplies `createPendingAction` (queueing into the per-conversation
`PendingActionManager`, persisted under `~/.yomi/state/`), so `gateWrite()`
gates writes on desktop exactly as the backend gates Telegram writes. Approval
synonyms ("yes", "/approve", …) are intercepted before intent routing and
replay the stored tool call — see `apps/sidecar/src/conversation/`.
```

- [ ] **Step 8: Commit checkpoint (hand off)**

Message: `feat: gate sidecar connector writes through pending actions`

---

### Task 3: Approval interception + ungated replay executor

Intercept approval/rejection turns **before** `classifyIntent` — a bare "yes" currently routes to the fast path, which knows nothing about approvals (this is exactly the "What are we saying yes to?" bug). On approval, replay the stored tool call by rebuilding the connector's tools **without** `createPendingAction` (mirroring backend `replayConnectorTool`, `apps/backend/src/services/pending-actions.ts:177-198`) so `gateWrite` runs the real API call instead of re-queuing.

**Files:**
- Create: `apps/sidecar/src/conversation/approval-executor.ts`
- Modify: `apps/sidecar/src/pipeline/conversation-bridge.ts` (delete stale `resolveUserInput`)
- Modify: `apps/sidecar/src/index.ts` (`/query` and `/query/agent` routes)
- Modify: `apps/sidecar/src/gateway/receive.ts`
- Test: `apps/sidecar/src/conversation/approval-executor.test.ts`

**Interfaces:**
- Consumes: `getConversationState(key)`, `isApprovalOrRejection(text)` (types.ts), `getConnectorRegistry()` + `getUserId()`, `ALL_CONNECTOR_DEFS` from `@yomi/agent-core`, `hooks` from `../harness/hooks.js`.
- Produces: `handleApprovalTurn(text: string, key: string, deps?: ApprovalDeps): Promise<SseEvent[] | null>` — `null` means "not an approval/rejection turn or nothing pending; proceed normally". `ApprovalDeps = { replayTool?: (toolName: string, args: Record<string, unknown>) => Promise<unknown> }` for tests.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, beforeEach } from "bun:test"
import { handleApprovalTurn } from "./approval-executor.js"
import { getConversationState, resetConversationState } from "./conversation-state.js"

function seedPending(key: string) {
  getConversationState(key).pendingActions.create({
    type: "github-createOrUpdateFile", title: "Create recursion.go in u/golang-practice",
    description: "path: recursion.go", toolName: "github-createOrUpdateFile",
    toolArguments: { owner: "u", repo: "golang-practice", path: "recursion.go", content: "cGtn", message: "add recursion.go" },
    conversationSummary: "create recursion.go",
  })
}

describe("handleApprovalTurn", () => {
  beforeEach(() => resetConversationState())

  it("returns null for a normal message", async () => {
    expect(await handleApprovalTurn("what's the weather", "desktop")).toBeNull()
  })

  it("returns null for approval with nothing pending", async () => {
    expect(await handleApprovalTurn("yes", "desktop")).toBeNull()
  })

  it("executes the stored tool call verbatim on approval", async () => {
    seedPending("desktop")
    let calledWith: unknown = null
    const events = await handleApprovalTurn("yes", "desktop", {
      replayTool: async (_name, args) => {
        calledWith = args
        return { path: "recursion.go", commitSha: "abc1234", url: "https://github.com/u/golang-practice/blob/main/recursion.go" }
      },
    })
    expect(calledWith).toEqual({ owner: "u", repo: "golang-practice", path: "recursion.go", content: "cGtn", message: "add recursion.go" })
    const text = (events ?? []).filter((e) => e.type === "agent_text").map((e) => (e as { text: string }).text).join("")
    expect(text).toContain("recursion.go")
    expect(text).toContain("abc1234")
    expect(getConversationState("desktop").pendingActions.getLatest()).toBeUndefined()
  })

  it("cancels on rejection", async () => {
    seedPending("desktop")
    const events = await handleApprovalTurn("no", "desktop")
    expect(events?.some((e) => e.type === "agent_text" && (e as { text: string }).text.includes("Cancelled"))).toBe(true)
    expect(getConversationState("desktop").pendingActions.listPending()).toHaveLength(0)
  })

  it("marks the action failed and reports the error when replay throws", async () => {
    seedPending("desktop")
    const events = await handleApprovalTurn("approve", "desktop", {
      replayTool: async () => { throw new Error("422 name already exists") },
    })
    expect(events?.some((e) => e.type === "error" || (e.type === "agent_text" && (e as { text: string }).text.includes("failed")))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/sidecar/src/conversation/approval-executor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `approval-executor.ts`**

```ts
import type { SseEvent } from "@yomi/shared"
import { ALL_CONNECTOR_DEFS } from "@yomi/agent-core"
import { getConversationState } from "./conversation-state.js"
import { isApprovalOrRejection } from "./types.js"
import { hooks } from "../harness/hooks.js"
import { getConnectorRegistry } from "../connectors/registry.js"

export interface ApprovalDeps {
  replayTool?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
}

type ExecutableTool = { execute?: (args: unknown, opts: unknown) => Promise<unknown> }

// Rebuilds the owning connector's tools WITHOUT createPendingAction so
// gateWrite() runs the real API call instead of re-queuing the approval.
// Mirrors apps/backend/src/services/pending-actions.ts replayConnectorTool.
async function replayConnectorTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const registry = getConnectorRegistry()
  const userId = registry.getUserId()
  if (!userId) throw new Error("No connected user — sign in and retry")
  const family = toolName.split("-")[0]
  const def = ALL_CONNECTOR_DEFS.find(
    (d) => d.id === family || d.id.startsWith(`${family}`) || toolName.startsWith(`${d.id}-`),
  )
  // Fall back to scanning every def for the exact tool key (gmail lives under "google").
  const defs = def ? [def] : ALL_CONNECTOR_DEFS
  for (const d of defs.length ? defs : ALL_CONNECTOR_DEFS) {
    const tools = d.tools({ userId, getAccessToken: registry.deps.getAccessToken }) as Record<string, ExecutableTool>
    const t = tools[toolName]
    if (t?.execute) return t.execute(args, { toolCallId: toolName, messages: [] })
  }
  throw new Error(`No executor for tool ${toolName}`)
}

function formatResult(toolName: string, title: string, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>
  const lines: string[] = [`Done: ${title}`]
  const push = (label: string, v: unknown) => {
    if (typeof v === "string" && v) lines.push(`${label}: ${v}`)
  }
  push("Link", (r.url ?? r.htmlLink ?? r.link ?? r.permalink) as string)
  push("Commit", r.commitSha as string)
  push("Branch", r.branch as string)
  push("Path", r.path as string)
  push("Title", (r.title ?? r.name ?? r.subject ?? r.summary) as string)
  push("When", (r.start ?? r.startTime) as string)
  push("Issue", r.identifier as string)
  if (typeof r.message === "string" && lines.length === 1) lines.push(r.message)
  return lines.join("\n")
}

export async function handleApprovalTurn(
  text: string,
  key: string,
  deps?: ApprovalDeps,
): Promise<SseEvent[] | null> {
  const decision = isApprovalOrRejection(text)
  if (!decision) return null

  const state = getConversationState(key)
  const pending = state.pendingActions.getLatest()
  if (!pending || pending.status !== "pending") return null

  if (decision === "reject") {
    state.pendingActions.reject(pending.id)
    state.persist()
    return [{ type: "agent_text", text: `Cancelled: ${pending.title}.` }, { type: "done" }]
  }

  state.pendingActions.approve(pending.id)
  state.pendingActions.startExecuting(pending.id)
  const replay = deps?.replayTool ?? replayConnectorTool
  const events: SseEvent[] = [
    { type: "agent_tool_call", tool: pending.toolName, args: pending.toolArguments },
  ]
  try {
    const pre = await hooks.onPreToolUse(pending.toolName, pending.toolArguments)
    if (!pre.ok) throw new Error(pre.reason ?? "blocked by guardrail")
    const raw = await replay(pending.toolName, pending.toolArguments)
    const result = await hooks.onPostToolUse(pending.toolName, raw, pending.toolArguments)
    state.pendingActions.complete(pending.id, result)
    state.persist()
    events.push({ type: "agent_tool_result", tool: pending.toolName, result })
    events.push({ type: "agent_text", text: formatResult(pending.toolName, pending.title, result) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.pendingActions.fail(pending.id, message)
    state.persist()
    events.push({ type: "agent_text", text: `Approved, but execution failed: ${message}` })
    events.push({ type: "error", message })
  }
  events.push({ type: "done" })
  return events
}
```

Note: `registry.deps` is `private readonly` in agent-core — also add alongside Task 2's `getUserId()`:

```ts
getTokenProvider(): TokenProvider {
  return this.deps.getAccessToken
}
```

and use `registry.getTokenProvider()` in the replay above (not `registry.deps.getAccessToken`).

`hooks.onPostToolUse` already calls `registerEntityForToolResult`, so the executed action automatically becomes the active entity (spec §8) — no extra wiring.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/sidecar/src/conversation/approval-executor.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete stale `resolveUserInput` from `conversation-bridge.ts`**

Remove `ResolvedInput`, `resolveUserInput`, and the now-unused `isApprovalOrRejection` import (keep `registerEntityForToolResult` and everything below it). It was never wired and its "rewrite to `/approve <id>` and let the LLM handle it" design is superseded by deterministic execution.

- [ ] **Step 6: Wire interception into `index.ts` `/query` (before `classifyIntent`)**

In the `/query` handler, right after the `if (!text)` guard and before `classifyIntent`:

```ts
const { handleApprovalTurn } = await import("./conversation/approval-executor.js")
const approvalEvents = await handleApprovalTurn(text, body.conversationId ?? "desktop")
if (approvalEvents) {
  try {
    logUsageEvent({ kind: "agent_run" })
  } catch {
    // best-effort
  }
  for (const e of approvalEvents) {
    await stream.writeSSE({ data: JSON.stringify(e) })
  }
  return
}
```

Apply the same block at the top of the `/query/agent` streamSSE body (before `getAgentDriver()`), using `body.conversationId ?? "desktop"`.

- [ ] **Step 7: Wire interception into `gateway/receive.ts` (before `classifyIntent`)**

In `handleGatewayMessage`, after the `reserveInteraction("bot_message")` block and `initConnectorRegistry`, before `classifyIntent`:

```ts
const { handleApprovalTurn } = await import("../conversation/approval-executor.js")
const { setActiveConversation } = await import("../conversation/active-conversation.js")
setActiveConversation(chatKey(msg))
const approvalEvents = await handleApprovalTurn(text, chatKey(msg))
if (approvalEvents) {
  const replyText = approvalEvents
    .filter((e): e is Extract<SseEvent, { type: "agent_text" }> => e.type === "agent_text")
    .map((e) => e.text)
    .join("")
  if (replyText) {
    pushHistory(msg, text, replyText)
    await sendReply(msg.platform, msg.chatId, replyText)
  }
  return
}
```

- [ ] **Step 8: Add `conversationId` to shared request types**

In `packages/shared/src/index.ts`, add to both `FastQueryRequest` and `AgentQueryRequest`:

```ts
conversationId?: string // scopes conversation state; defaults to "desktop"
```

- [ ] **Step 9: Run the sidecar test suite**

Run: `bun test apps/sidecar/`
Expected: PASS (gateway receive tests may need the new import mocked — if `receive.test.ts` fails on registry/user lookups, stub `handleApprovalTurn`'s registry path by asserting only on non-approval messages).

- [ ] **Step 10: Commit checkpoint (hand off)**

Message: `feat: intercept approval turns and replay stored pending actions`

---

### Task 4: Prompt injection + turn recording in the agent pipeline

`buildAgentPrompt` renders `<conversation_state>` from a module-level block that nothing ever sets — the detailed `<conversation_rules>` (prompt.ts:286-321) reference `<pending_action>`/`<active_context>` blocks that are always absent. Fix by threading the real state through `PromptContext`, and record turns so `<recent_turns>` fills.

**Files:**
- Modify: `apps/sidecar/src/harness/prompt.ts`
- Modify: `apps/sidecar/src/pipeline/agent.ts`
- Modify: `apps/sidecar/src/pipeline/fast.ts`
- Test: `apps/sidecar/src/harness/prompt.test.ts` (extend)

**Interfaces:**
- Consumes: `getConversationState(key).toSystemPromptBlock()`, `setActiveConversation(key)` from Task 2.
- Produces: `PromptContext.conversationState?: string`; `buildFastPrompt`/`buildAgentPrompt` render it; `agentPipeline` records `user`/`assistant` turns and always accumulates `fullText`.

- [ ] **Step 1: Write the failing test**

Append to `harness/prompt.test.ts`:

```ts
it("injects the conversation state block into agent and fast prompts", () => {
  const block = "<active_context>\nRepo: u/golang-practice\n</active_context>"
  const agent = buildAgentPrompt({ conversationState: block })
  expect(agent).toContain("Repo: u/golang-practice")
  const fast = buildFastPrompt({ text: "hi", tts: false, conversationState: block })
  expect(fast).toContain("Repo: u/golang-practice")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/sidecar/src/harness/prompt.test.ts`
Expected: FAIL — `conversationState` not in `PromptContext`.

- [ ] **Step 3: Implement in `prompt.ts`**

1. Add `conversationState?: string` to `PromptContext`; add `conversationState: ctx.conversationState ?? ""` in `resolveCtx`.
2. Delete `_conversationStateBlock`, `setConversationStateBlock`, `getConversationStateBlock` (no callers exist — verified).
3. In `buildAgentPrompt`, destructure `conversationState` from `resolveCtx(ctx)` and replace `const convState = _conversationStateBlock || ""` with `const convState = conversationState`.
4. In `buildFastPrompt`, append before the final return-template's `${connInfo}${memCtx}` tail: `const convCtx = resolved.conversationState ? `<conversation_state>\n${resolved.conversationState}\n</conversation_state>\n` : ""` and render `${convCtx}` after `${connInfo}` (keeps the cached long prefix first, per the file's comment about per-turn dynamic tail).
5. Move the `CONVERSATION_RULES` block so it is only included when `convState` is non-empty in the agent prompt? **No** — keep it always included: rules also teach the model to ask "What would you like to approve?" when nothing is pending.

- [ ] **Step 4: Thread state through `pipeline/agent.ts`**

In `getAgentPrompt(text, plan)` add a third parameter `conversationKey: string` and include:

```ts
import { getConversationState } from "../conversation/conversation-state.js"
// inside getAgentPrompt:
const conversationState = getConversationState(conversationKey).toSystemPromptBlock()
return buildAgentPrompt({ ..., connectedProviders, conversationState })
```

In `agentPipeline`, at the top (after the soul-onboarding shortcut):

```ts
import { setActiveConversation } from "../conversation/active-conversation.js"
const conversationKey = req.conversationId ?? "desktop"
setActiveConversation(conversationKey)
```

and pass `conversationKey` to `getAgentPrompt(req.text, req.plan, conversationKey)`.

Fix `fullText` accumulation (currently only when `ttsEnabled`), in the `text-delta` case:

```ts
fullText += event.textDelta
```

(remove the `if (ttsEnabled)` guard; TTS synthesis below already checks `ttsEnabled`).

After the `await activeHooks.onStop(summary)` line, record the turn:

```ts
const convState = getConversationState(conversationKey)
convState.addTurn({ role: "user", text: req.text, timestamp: new Date() })
if (fullText.trim()) {
  convState.addTurn({ role: "assistant", text: fullText.trim(), timestamp: new Date() })
}
```

- [ ] **Step 5: Thread state through `pipeline/fast.ts`**

Where `buildFastPrompt` is called (fast.ts:57), add:

```ts
import { getConversationState } from "../conversation/conversation-state.js"
// in the options object passed to buildFastPrompt:
conversationState: getConversationState(req.conversationId ?? "desktop").toSystemPromptBlock(),
```

(match the actual local variable name for the request in that function).

- [ ] **Step 6: Run tests**

Run: `bun test apps/sidecar/src/harness/ apps/sidecar/src/pipeline/`
Expected: PASS, including existing prompt cache-order tests.

- [ ] **Step 7: Commit checkpoint (hand off)**

Message: `feat: inject conversation state into prompts and record turns`

---

### Task 5: Conversation identity plumbing + uploaded-file entities

**Files:**
- Modify: `apps/sidecar/src/gateway/receive.ts`
- Test: `apps/sidecar/src/gateway/receive.test.ts` (extend)

**Interfaces:**
- Consumes: `conversationId` on request types (Task 3 step 8), `getConversationState(key).registerEntity`.
- Produces: gateway passes `conversationId: chatKey(msg)` to both pipelines; document uploads register an `uploaded_file` entity so "summarize it" resolves.

- [ ] **Step 1: Write the failing test**

Append to `receive.test.ts` (follow the file's existing mocking style for `fetch`/pipelines):

```ts
it("registers an uploaded_file entity when a document arrives", async () => {
  // arrange a GatewayMessage with documentUrl + documentFileName "obc.pdf",
  // stub extractText to return { text: "PDF CONTENT" } (mock ../tools/documents.js)
  // act: handleGatewayMessage(msg)
  const state = getConversationState("telegram:99")
  expect(state.entityStore.getActiveContext().currentUploadedFile?.filename).toBe("obc.pdf")
})
```

Adapt the arrange step to the mocking utilities already used in that test file (it stubs `fetch` and pipeline generators — reuse the same helpers).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/sidecar/src/gateway/receive.test.ts`
Expected: FAIL — no entity registered.

- [ ] **Step 3: Implement in `receive.ts`**

In the document auto-parsing block, after `msg = { ...msg, text: updatedText }`:

```ts
import { getConversationState } from "../conversation/conversation-state.js"
// inside the try, after building updatedText:
getConversationState(chatKey(msg)).registerEntity({
  type: "uploaded_file",
  title: docName,
  summary: `Uploaded document (${result.text.length} chars extracted)`,
  metadata: { url: msg.documentUrl, mimeType: msg.documentMimeType, filename: docName, extractedText: preview },
})
```

In both pipeline invocations pass the key: `fastPipeline({ text, tts: false, plan: "max", history, skipReserve: true, conversationId: chatKey(msg) })` and `driver({ text, plan: "max", history, skipReserve: true, conversationId: chatKey(msg) })`.

- [ ] **Step 4: Run tests**

Run: `bun test apps/sidecar/src/gateway/`
Expected: PASS.

- [ ] **Step 5: Commit checkpoint (hand off)**

Message: `feat: scope gateway conversations and track uploaded documents`

---

### Task 6: Fix entity-mapping tool names in conversation-bridge

The `entityForToolResult` switch maps tool names that don't all exist. Verified against def keys (`grep '"[a-z-]+-[a-zA-Z]+": tool('` over `packages/agent-core/src/connectors/*-def.ts`): `gmail-send` must be `gmail-sendEmail`; also skip registering entities for gated "approval required" returns.

**Files:**
- Modify: `apps/sidecar/src/pipeline/conversation-bridge.ts`
- Test: `apps/sidecar/src/pipeline/conversation-bridge.test.ts` (create)

**Interfaces:**
- Consumes: tool result shapes from connector defs.
- Produces: corrected mapping; a guard so `{ id, status: "pending", message }` gate returns never register entities.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, beforeEach } from "bun:test"
import { registerEntityForToolResult } from "./conversation-bridge.js"
import { getConversationState, resetConversationState } from "../conversation/conversation-state.js"
import { setActiveConversation } from "../conversation/active-conversation.js"

describe("registerEntityForToolResult", () => {
  beforeEach(() => {
    resetConversationState()
    setActiveConversation("desktop")
  })

  it("registers gmail-sendEmail results", () => {
    registerEntityForToolResult("gmail-sendEmail", { to: ["a@b.c"], subject: "Hi" }, { messageId: "m1" })
    expect(getConversationState().entityStore.getLatestByType("gmail_message")?.title).toBe("Hi")
  })

  it("does NOT register an entity for a pending-action gate return", () => {
    registerEntityForToolResult(
      "github-createOrUpdateFile",
      { owner: "u", repo: "r", path: "f.go" },
      { id: "pa_x", status: "pending", message: "Approval required: ..." },
    )
    expect(getConversationState().entityStore.getLatestByType("github_file")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/sidecar/src/pipeline/conversation-bridge.test.ts`
Expected: FAIL — `gmail-send` case doesn't match `gmail-sendEmail`; gate return registers a `github_file`.

- [ ] **Step 3: Implement fixes**

1. In `registerEntityForToolResult`, after `normalizeToolResult`, add the gate guard:

```ts
// Gated writes return { id, status: "pending", message } — not a real result.
if (r.status === "pending" && typeof r.id === "string") return
```

2. Rename cases to real def keys: `case "gmail-send":` → `case "gmail-sendEmail":` and add `case "gmail-sendDraft":` alongside. Verify each remaining case name against the def key list; they already match (`github-createOrUpdateFile`, `github-createRepo`, `github-createIssue`, `github-updateIssue`, `github-createPR`, `github-createBranch`, `github-getFileContents`, `calendar-createEvent`, `calendar-quickAdd`, `calendar-createEventWithMeet`, `drive-createFile`, `drive-createFolder`, `gmail-createDraft`, `slack-sendMessage`, `linear-createIssue`, `read_document`, `bash`).
3. `registerEntityForToolResult` currently writes to the default conversation via `getConversationState()` — change it to `getConversationState(getActiveConversation())` (import from `../conversation/active-conversation.js`) so gateway chats register into their own state.

- [ ] **Step 4: Run tests**

Run: `bun test apps/sidecar/src/pipeline/`
Expected: PASS.

- [ ] **Step 5: Commit checkpoint (hand off)**

Message: `fix: align entity mapping with real connector tool keys`

---

### Task 7: End-to-end conversation test + full CI

Script the spec's success-criteria conversation against stubbed tools: gated create → "yes" replays stored args verbatim (never re-asks) → result registers the file as active entity → state survives a simulated restart.

**Files:**
- Create: `apps/sidecar/src/conversation/flow.e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: regression coverage for the exact reported bugs.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, beforeEach } from "bun:test"
import { rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { getConversationState, resetConversationState } from "./conversation-state.js"
import { setActiveConversation, makeSidecarPendingActionDep } from "./active-conversation.js"
import { handleApprovalTurn } from "./approval-executor.js"
import { registerEntityForToolResult } from "../pipeline/conversation-bridge.js"

const KEY = "e2e-test"
const stateFile = join(
  process.env.USERPROFILE ?? homedir(), ".yomi", "state", `conversation-${KEY}.json`,
)

describe("success-criteria conversation flow", () => {
  beforeEach(() => {
    resetConversationState()
    try { rmSync(stateFile) } catch { /* ignore */ }
    setActiveConversation(KEY)
  })

  it("create → approve → active entity → survives restart", async () => {
    // Turn 1: agent hits the gate — tool returns "approval required"
    const dep = makeSidecarPendingActionDep()
    const gate = await dep({
      connector: "github", action: "github-createOrUpdateFile", risk: "write",
      title: "Create recursion.go in u/golang-practice", preview: "path: recursion.go",
      payload: { owner: "u", repo: "golang-practice", path: "recursion.go", content: "cGtn", message: "add recursion.go" },
    })
    expect(gate.message).toContain("Approval required")

    // Prompt for turn 2 must carry the pending action — no context loss
    expect(getConversationState(KEY).toSystemPromptBlock()).toContain("Create recursion.go")

    // Simulated sidecar restart: state must reload from disk
    resetConversationState(KEY)
    expect(getConversationState(KEY).pendingActions.getLatest()?.toolName)
      .toBe("github-createOrUpdateFile")

    // Turn 2: "yes" executes the STORED args — nothing re-asked, nothing rebuilt
    let replayed: Record<string, unknown> | null = null
    const events = await handleApprovalTurn("yes", KEY, {
      replayTool: async (_n, args) => {
        replayed = args
        return { path: "recursion.go", commitSha: "abc1234", url: "https://github.com/u/golang-practice/..." }
      },
    })
    expect(replayed).toEqual({ owner: "u", repo: "golang-practice", path: "recursion.go", content: "cGtn", message: "add recursion.go" })
    expect(events?.some((e) => e.type === "done")).toBe(true)

    // Turn 3: "show me" — the created file is the active entity
    const ctx = getConversationState(KEY).entityStore.getActiveContext()
    expect(ctx.currentFile?.path).toBe("recursion.go")

    // A second "yes" with nothing pending falls through to normal routing
    expect(await handleApprovalTurn("yes", KEY)).toBeNull()
  })

  it("upload → 'summarize it' context", () => {
    registerEntityForToolResult(
      "read_document",
      { url: "https://x/obc.pdf", mimeType: "application/pdf" },
      { text: "PDF CONTENT" },
    )
    const block = getConversationState(KEY).toSystemPromptBlock()
    expect(block).toContain("obc.pdf")
  })
})
```

- [ ] **Step 2: Run it**

Run: `bun test apps/sidecar/src/conversation/flow.e2e.test.ts`
Expected: PASS. If the active-entity assertion fails, check that `handleApprovalTurn` routes results through `hooks.onPostToolUse` (Task 3) — that is what registers the entity.

- [ ] **Step 3: Full CI**

Run: `bun run ci`
Expected: build, typecheck, lint, and all tests green. Fix anything that regressed (most likely: unused imports removed in Task 3 step 5, or `prompt.test.ts` snapshots).

- [ ] **Step 4: Commit checkpoint (hand off)**

Message: `test: end-to-end conversation state and approval flow coverage`

---

## Coverage against the spec's 14 problems

| Spec § | Covered by |
| --- | --- |
| 1 Confirmation context lost | Tasks 2 (gate creates pending), 3 (interception), 4 (prompt sees it) |
| 2 /approve broken | Task 3 (deterministic execution of the stored action; never rebuilt) |
| 3 Planner context survives | Task 2 (full tool args stored at gate time), Task 3 (verbatim replay) |
| 4 Pronoun resolution | Task 4 (active-context block + existing `<conversation_rules>` now have real data); `ReferenceResolver` remains available for future deterministic short-circuits |
| 5 Uploaded files active | Task 5 (gateway) + existing `read_document` mapping (Task 6 verifies) |
| 6 Workspace tool selection | Already in prompt rules (prompt.ts:302-306) — becomes effective once state block is non-empty (Task 4); `workspace-mapper.ts` stays as tested utility |
| 7 Rich responses | Task 3 `formatResult` + prompt rules (prompt.ts:311-318) |
| 8 Follow-up context | Task 3 (post-execution entity registration via hooks) |
| 9 Memory window | Task 1 (turns/entities/active-context per key, persisted) |
| 10 Approval synonyms | Already complete in `types.ts` (verified superset of spec list); wired by Task 3 |
| 11 Lifecycle + survival | Task 1 (persistence), existing status machine in `pending-action.ts` |
| 12 Never ask for known info | Tasks 2+4 (stored args + injected context + existing rules) |
| 13 Tool result memory | Task 6 (fixed mappings) + existing hook wiring |
| 14 Success criteria | Task 7 e2e test |

**Deliberately out of scope (YAGNI, agreed architecture):** LLM-based reference resolution (prompt injection covers it), backend/Telegram path changes (already works via `services/pending-actions.ts`), fast-path approval handling beyond pre-router interception, desktop UI approval buttons.
