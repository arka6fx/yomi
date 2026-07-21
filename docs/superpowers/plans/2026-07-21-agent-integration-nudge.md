# Telegram Agent Integration Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user's Telegram message names an app/task that needs a connector Yomi supports but hasn't connected, the agent names it and hands back a deep link straight to that connector on the dashboard — computed fresh per message from what's actually relevant, never a full catalog dump.

**Architecture:** A pure suggestion/formatting module in `agent-core`, wired into the existing system-prompt builder in `apps/backend/src/agent/run.ts`, plus a small `?connect=<id>` deep-link addition to the dashboard's existing URL-param `useEffect` and a `highlightId` prop threaded through the two `ui-connectors` components that render the connector list.

**Tech Stack:** TypeScript, Bun test, AI SDK `tool()` (unrelated to this feature but same package), React (dashboard + ui-connectors).

## Global Constraints

- Full design rationale, rejected alternatives, and exact wording live in
  `docs/superpowers/specs/2026-07-21-agent-integration-nudge-design.md` —
  read it if anything here seems underspecified.
- Matching is **whole-word, case-insensitive** (`\b<word>\b` regex), never
  substring (`.includes()`) — a short name like "Exa" must not match
  inside "example".
- `swiggy` is always excluded from suggestions regardless of connection
  state (blocked on Swiggy's OAuth allowlist — see spec).
- Suggestions are capped at 3 per message.
- No new database state anywhere in this feature.
- No LLM-behavior tests and no React component tests — this repo has
  neither harness set up for these packages; verify the agent-core pure
  functions with `bun test`, verify the UI pieces by running the app.
- Every modified package must pass `bun run typecheck` and `bun run lint`
  before its task is considered done.

---

### Task 1: `suggestIntegrationsFor` — matching, exclusions, cap

**Files:**
- Create: `packages/agent-core/src/integration-catalog.ts`
- Create: `packages/agent-core/src/integration-catalog.test.ts`

**Interfaces:**
- Consumes: `ALL_CONNECTOR_DEFS` from `./connectors/all-defs.js` (existing,
  60-entry array of `ConnectorDef`, each with `id: string`, `name: string`,
  `category: ConnectorCategory`), `type ConnectorCategory` from
  `./connectors/connector-def.js`.
- Produces: `export interface IntegrationSuggestion { id: string; name:
  string; category: ConnectorCategory }` and `export function
  suggestIntegrationsFor(text: string, connectedIds: string[]):
  IntegrationSuggestion[]` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Write the failing tests (core matching)**

Create `packages/agent-core/src/integration-catalog.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { suggestIntegrationsFor } from "./integration-catalog.js"

describe("suggestIntegrationsFor", () => {
  it("matches a single-word connector name named directly in the text", () => {
    const result = suggestIntegrationsFor("can you check my Trello board", [])
    expect(result.some((s) => s.id === "trello")).toBe(true)
  })

  it("matches one word of a multi-word connector name", () => {
    const result = suggestIntegrationsFor("what's on my calendar today", [])
    expect(result.some((s) => s.id === "google-calendar")).toBe(true)
  })

  it("does not match a short name as a substring inside an unrelated word", () => {
    const result = suggestIntegrationsFor("give me an example of this", [])
    expect(result.some((s) => s.id === "exa")).toBe(false)
  })

  it("returns an empty array for a message that names nothing connector-related", () => {
    const result = suggestIntegrationsFor("what's the weather like today", [])
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent-core && bun test src/integration-catalog.test.ts`
Expected: FAIL with "Cannot find module './integration-catalog.js'"

- [ ] **Step 3: Write the implementation (core matching)**

Create `packages/agent-core/src/integration-catalog.ts`:

```ts
import { ALL_CONNECTOR_DEFS } from "./connectors/all-defs.js"
import type { ConnectorCategory } from "./connectors/connector-def.js"

export interface IntegrationSuggestion {
  id: string
  name: string
  category: ConnectorCategory
}

// Connectors excluded from nudges regardless of connection state — not
// actually connectable yet, so suggesting them would be false hope.
// swiggy: code done, blocked on Swiggy's OAuth client allowlist (issue #73
// on their manifest repo).
const NUDGE_EXCLUDED_IDS = new Set(["swiggy"])

const MAX_SUGGESTIONS = 3

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Whole-word match against any significant (>=3 char) word in the
// connector's display name — e.g. "calendar" matches "Google Calendar",
// but "example" does not match "Exa" (word-boundary regex, not substring).
function nameMatches(name: string, lowerText: string): boolean {
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  return words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(lowerText))
}

export function suggestIntegrationsFor(
  text: string,
  connectedIds: string[],
): IntegrationSuggestion[] {
  const lowerText = text.toLowerCase()
  const connected = new Set(connectedIds)
  const matches: IntegrationSuggestion[] = []

  for (const def of ALL_CONNECTOR_DEFS) {
    if (connected.has(def.id) || NUDGE_EXCLUDED_IDS.has(def.id)) continue
    if (!nameMatches(def.name, lowerText)) continue
    matches.push({ id: def.id, name: def.name, category: def.category })
    if (matches.length >= MAX_SUGGESTIONS) break
  }

  return matches
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent-core && bun test src/integration-catalog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests (exclusions + cap)**

Append to `packages/agent-core/src/integration-catalog.test.ts`, inside the
existing `describe("suggestIntegrationsFor", ...)` block, right after the
last `it(...)`:

```ts
  it("excludes already-connected connectors even when named in the text", () => {
    const result = suggestIntegrationsFor("can you check my Trello board", ["trello"])
    expect(result.some((s) => s.id === "trello")).toBe(false)
  })

  it("excludes swiggy even when named and unconnected", () => {
    const result = suggestIntegrationsFor("order food from Swiggy", [])
    expect(result.some((s) => s.id === "swiggy")).toBe(false)
  })

  it("caps results at 3 when the message names more than 3 unconnected connectors", () => {
    const result = suggestIntegrationsFor(
      "connect this to Trello, Jira, Asana, and Notion",
      [],
    )
    expect(result.length).toBe(3)
  })
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd packages/agent-core && bun test src/integration-catalog.test.ts`
Expected: FAIL — "excludes already-connected connectors..." fails because
nothing filters `connectedIds` yet; "excludes swiggy..." fails because
nothing excludes it yet; the cap test passes vacuously (no cap yet, but
also no more than 3 real matches from that message, so verify it actually
fails first — if it doesn't, that's fine, the other two failures are what
matter here).

- [ ] **Step 7: Extend the implementation (exclusions + cap)**

The implementation from Step 3 already includes the `connected.has(def.id)
|| NUDGE_EXCLUDED_IDS.has(def.id)` skip and the `MAX_SUGGESTIONS` break —
no further code change needed here. Re-run to confirm.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/agent-core && bun test src/integration-catalog.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 9: Typecheck**

Run: `cd packages/agent-core && bun run typecheck`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add packages/agent-core/src/integration-catalog.ts packages/agent-core/src/integration-catalog.test.ts
git commit -m "feat(agent-core): add suggestIntegrationsFor for the integration nudge"
```

---

### Task 2: `formatIntegrationSuggestions` + package exports

**Files:**
- Modify: `packages/agent-core/src/integration-catalog.ts`
- Modify: `packages/agent-core/src/integration-catalog.test.ts`
- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**
- Consumes: `IntegrationSuggestion` from Task 1.
- Produces: `export function formatIntegrationSuggestions(suggestions:
  IntegrationSuggestion[], appUrl: string): string` — consumed by Task 3.
  Both `suggestIntegrationsFor` and `formatIntegrationSuggestions` (plus
  the `IntegrationSuggestion` type) exported from `@yomi/agent-core`'s
  package root — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to
`packages/agent-core/src/integration-catalog.test.ts`, and update the
import line at the top of the file:

```ts
import { formatIntegrationSuggestions, suggestIntegrationsFor } from "./integration-catalog.js"
```

```ts
describe("formatIntegrationSuggestions", () => {
  it("returns an empty string for no suggestions", () => {
    expect(formatIntegrationSuggestions([], "https://getyomi.in")).toBe("")
  })

  it("renders one suggestion with its deep link", () => {
    const result = formatIntegrationSuggestions(
      [{ id: "trello", name: "Trello", category: "productivity" }],
      "https://getyomi.in",
    )
    expect(result).toBe("Trello (productivity): https://getyomi.in/dashboard?connect=trello")
  })

  it("renders multiple suggestions one per line", () => {
    const result = formatIntegrationSuggestions(
      [
        { id: "trello", name: "Trello", category: "productivity" },
        { id: "notion", name: "Notion", category: "knowledge" },
      ],
      "https://getyomi.in",
    )
    expect(result).toBe(
      "Trello (productivity): https://getyomi.in/dashboard?connect=trello\n" +
        "Notion (knowledge): https://getyomi.in/dashboard?connect=notion",
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent-core && bun test src/integration-catalog.test.ts`
Expected: FAIL — `formatIntegrationSuggestions` is not exported yet.

- [ ] **Step 3: Write the implementation**

Append to `packages/agent-core/src/integration-catalog.ts`:

```ts
export function formatIntegrationSuggestions(
  suggestions: IntegrationSuggestion[],
  appUrl: string,
): string {
  if (suggestions.length === 0) return ""
  return suggestions
    .map((s) => `${s.name} (${s.category}): ${appUrl}/dashboard?connect=${s.id}`)
    .join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent-core && bun test src/integration-catalog.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Export from the package root**

In `packages/agent-core/src/index.ts`, find the existing web-search export
block (`export { createWebSearchTool, searchWeb, ... } from
"./web-search.js"`) and add immediately after it:

```ts
export {
  suggestIntegrationsFor,
  formatIntegrationSuggestions,
  type IntegrationSuggestion,
} from "./integration-catalog.js"
```

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/agent-core && bun run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/integration-catalog.ts packages/agent-core/src/integration-catalog.test.ts packages/agent-core/src/index.ts
git commit -m "feat(agent-core): add formatIntegrationSuggestions and export integration-catalog"
```

---

### Task 3: Wire into the backend agent's system prompt

**Files:**
- Modify: `apps/backend/src/agent/run.ts`

**Interfaces:**
- Consumes: `suggestIntegrationsFor`, `formatIntegrationSuggestions` from
  `@yomi/agent-core` (Task 2). `registry.getConnected(): string[]` (existing,
  `ConnectorRegistry` method). `appUrl` (existing local `const` in
  `runAgent`, line ~531: `process.env["YOMI_APP_URL"] ?? "https://getyomi.in"`).
- Produces: `buildSystemWithContext` gains a 7th, optional parameter. No
  other file depends on this signature today (confirmed: it's only called
  once, inside `runAgent` in this same file).

No new automated test for this task — per the spec, `buildSystemWithContext`
isn't behavior-tested beyond what flows into it, and the logic being wired
in (`suggestIntegrationsFor`/`formatIntegrationSuggestions`) is already
fully tested in Tasks 1–2. This task is pure composition; verify with
typecheck + the existing `run.test.ts` suite (no regressions) + a manual
read-through.

- [ ] **Step 1: Add the import**

In `apps/backend/src/agent/run.ts`, the existing import from
`@yomi/agent-core` reads:

```ts
import {
  ConnectorRegistry,
  createModel,
  createRecallTool,
  createWebSearchTool,
  runAgentLoop,
  searchWeb,
  type AgentMessage,
  type UsageInfo,
} from "@yomi/agent-core"
```

Change it to:

```ts
import {
  ConnectorRegistry,
  createModel,
  createRecallTool,
  createWebSearchTool,
  formatIntegrationSuggestions,
  runAgentLoop,
  searchWeb,
  suggestIntegrationsFor,
  type AgentMessage,
  type UsageInfo,
} from "@yomi/agent-core"
```

- [ ] **Step 2: Extend `buildSystemWithContext`'s signature and body**

Find (around line 396):

```ts
export function buildSystemWithContext(
  memoryContext: string,
  ragContext: string,
  profile?: { staticProfile: string; dynamicProfile: string },
  userSoul?: string | null,
  recentChat?: string,
  timeZone?: string | null,
): string {
```

Change to:

```ts
export function buildSystemWithContext(
  memoryContext: string,
  ragContext: string,
  profile?: { staticProfile: string; dynamicProfile: string },
  userSoul?: string | null,
  recentChat?: string,
  timeZone?: string | null,
  integrationSuggestions?: string,
): string {
```

Find (around line 434-435):

```ts
    `If a tool reports a service is not connected, suggest they connect it at ${appUrl}/dashboard.\n` +
    `If a tool returns an authorization or token error, suggest they reconnect at ${appUrl}/dashboard.\n` +
    `\n` +
```

Change to:

```ts
    `If a tool reports a service is not connected, suggest they connect it at ${appUrl}/dashboard.\n` +
    `If a tool returns an authorization or token error, suggest they reconnect at ${appUrl}/dashboard.\n` +
    (integrationSuggestions
      ? `If the user's request needs an app you don't have a tool for, and it's named below, tell them by name and give them the link next to it to connect it — don't pretend you already did it. Don't repeat a nudge you already gave earlier in this conversation (check recent chat above).\n<available_integrations>\n${integrationSuggestions}\n</available_integrations>\n`
      : "") +
    `\n` +
```

(The instruction sentence and the block travel together, conditioned on
`integrationSuggestions` being non-empty: the instruction references
"named below," so it's meaningless without the block, and "don't repeat"
only matters on a turn where there's something fresh that could be
repeated. This keeps the common case — no relevant unconnected connector
this turn — at zero added prompt tokens.)

- [ ] **Step 3: Compute the suggestions in `runAgent` and pass them through**

Find (around line 579-582):

```ts
  const recallTool = createRecallTool((query, limit) =>
    searchSessions(opts.userId, query, limit),
  )
  const webSearchTool = createWebSearchTool((query) => searchWeb(query, opts.signal))
```

Change to:

```ts
  const recallTool = createRecallTool((query, limit) =>
    searchSessions(opts.userId, query, limit),
  )
  const webSearchTool = createWebSearchTool((query) => searchWeb(query, opts.signal))
  const integrationSuggestions = formatIntegrationSuggestions(
    suggestIntegrationsFor(opts.text, registry.getConnected()),
    appUrl,
  )
```

Find the `buildSystemWithContext` call site (around line 589-596):

```ts
      system: buildSystemWithContext(
        memoryContext,
        ragContext,
        profile,
        user.agentSoul,
        recentChat,
        userTimeZone,
      ),
```

Change to:

```ts
      system: buildSystemWithContext(
        memoryContext,
        ragContext,
        profile,
        user.agentSoul,
        recentChat,
        userTimeZone,
        integrationSuggestions,
      ),
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors

- [ ] **Step 5: Run the existing agent test suite to confirm no regressions**

Run: `cd apps/backend && bun test src/agent/run.test.ts`
Expected: PASS, same test count as before this task (14 tests, per the
last full run in this session)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/agent/run.ts
git commit -m "feat(backend): nudge users toward relevant unconnected connectors"
```

---

### Task 4: `highlightId` prop on `ConnectorMarketplace` / `ConnectorTile`

**Files:**
- Modify: `packages/ui-connectors/src/components/ConnectorMarketplace.tsx`

**Interfaces:**
- Consumes: nothing new (existing `ConnectorInfo`, `ConnectorTheme` types).
- Produces: `ConnectorMarketplaceProps` gains `highlightId?: string |
  null`. `ConnectorTileProps` gains `highlighted?: boolean`. Both exported
  via the existing `ConnectorMarketplace`/`ConnectorTile` named exports —
  consumed by Task 5.

No automated test — this package has no React component test harness
(only `catalog.test.ts`, which tests plain data, exists today). Verify
with typecheck + lint; end-to-end behavior is verified in Task 5.

- [ ] **Step 1: Add `useEffect`/`useRef` to the React import**

In `packages/ui-connectors/src/components/ConnectorMarketplace.tsx`, find:

```tsx
import React, { useState } from "react"
```

Change to:

```tsx
import React, { useEffect, useRef, useState } from "react"
```

- [ ] **Step 2: Add `highlighted` to `ConnectorTileProps` and scroll-into-view behavior**

Find:

```tsx
interface ConnectorTileProps {
  info: ConnectorInfo
  t: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loading?: boolean
  limitReached?: boolean
}

export function ConnectorTile({
  info,
  t,
  onConnect,
  onDisconnect,
  loading,
  limitReached,
}: ConnectorTileProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  function handleDisconnectClick() {
```

Change to:

```tsx
interface ConnectorTileProps {
  info: ConnectorInfo
  t: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loading?: boolean
  limitReached?: boolean
  highlighted?: boolean
}

export function ConnectorTile({
  info,
  t,
  onConnect,
  onDisconnect,
  loading,
  limitReached,
  highlighted,
}: ConnectorTileProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const tileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlighted && tileRef.current) {
      tileRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [highlighted])

  function handleDisconnectClick() {
```

- [ ] **Step 3: Give the tile an id, a ref, and highlight styling**

Find:

```tsx
  return (
    <div
      onMouseEnter={(e) => {
        if (info.available) e.currentTarget.style.borderColor = t.borderHi
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = t.border
      }}
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column" as const,
        gap: 14,
        opacity: !info.available ? 0.55 : 1,
        boxSizing: "border-box" as const,
        backdropFilter: t.backdropFilter,
        WebkitBackdropFilter: t.backdropFilter,
        boxShadow: t.cardShadow,
        transition: "border-color 0.15s ease",
      }}
    >
```

Change to:

```tsx
  return (
    <div
      ref={tileRef}
      id={`connector-${info.id}`}
      onMouseEnter={(e) => {
        if (info.available) e.currentTarget.style.borderColor = t.borderHi
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = highlighted ? t.accent : t.border
      }}
      style={{
        background: t.surface,
        border: `1px solid ${highlighted ? t.accent : t.border}`,
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column" as const,
        gap: 14,
        opacity: !info.available ? 0.55 : 1,
        boxSizing: "border-box" as const,
        backdropFilter: t.backdropFilter,
        WebkitBackdropFilter: t.backdropFilter,
        boxShadow: highlighted ? `0 0 0 3px ${t.accent}40, ${t.cardShadow}` : t.cardShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      }}
    >
```

- [ ] **Step 4: Add `highlightId` to `ConnectorMarketplaceProps` and pass `highlighted` down**

Find:

```tsx
interface ConnectorMarketplaceProps {
  connectors: ConnectorInfo[]
  theme?: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loadingId?: string | null
  limitReached?: boolean
}

export function ConnectorMarketplace({
  connectors,
  theme: t = DARK_THEME,
  onConnect,
  onDisconnect,
  loadingId,
  limitReached,
}: ConnectorMarketplaceProps) {
```

Change to:

```tsx
interface ConnectorMarketplaceProps {
  connectors: ConnectorInfo[]
  theme?: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loadingId?: string | null
  limitReached?: boolean
  highlightId?: string | null
}

export function ConnectorMarketplace({
  connectors,
  theme: t = DARK_THEME,
  onConnect,
  onDisconnect,
  loadingId,
  limitReached,
  highlightId,
}: ConnectorMarketplaceProps) {
```

Find:

```tsx
              {group.map((info) => (
                <ConnectorTile
                  key={info.id}
                  info={info}
                  t={t}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  loading={loadingId === info.id}
                  limitReached={limitReached && !info.connected}
                />
              ))}
```

Change to:

```tsx
              {group.map((info) => (
                <ConnectorTile
                  key={info.id}
                  info={info}
                  t={t}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  loading={loadingId === info.id}
                  limitReached={limitReached && !info.connected}
                  highlighted={highlightId === info.id}
                />
              ))}
```

- [ ] **Step 5: Typecheck and lint**

Run: `cd packages/ui-connectors && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/ui-connectors/src/components/ConnectorMarketplace.tsx
git commit -m "feat(ui-connectors): add highlightId to scroll to and highlight a connector"
```

---

### Task 5: Dashboard `?connect=<id>` deep link

**Files:**
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `highlightId` prop on `ConnectorMarketplace` (Task 4).
- Produces: nothing consumed elsewhere — this is the end of the chain.

No automated test (no React test harness in this app either). Verified by
running the app and visiting the URL directly, per this project's `run`
skill.

- [ ] **Step 1: Add the `highlightConnectorId` state**

Find (around line 204-207):

```tsx
  const [activeTab, setActiveTab] = useState<
    "account" | "integrations" | "memory" | "schedules" | "conversation" | "status" | "privacy"
  >("account")
  const [connectedProviders, setConnectedProviders] = useState<string[]>([])
```

Change to:

```tsx
  const [activeTab, setActiveTab] = useState<
    "account" | "integrations" | "memory" | "schedules" | "conversation" | "status" | "privacy"
  >("account")
  const [highlightConnectorId, setHighlightConnectorId] = useState<string | null>(null)
  const [connectedProviders, setConnectedProviders] = useState<string[]>([])
```

- [ ] **Step 2: Extend the URL-param `useEffect`**

Find (around line 291-309):

```tsx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setDesiredPlan(params.get("plan"))
    if (params.has("welcome")) setShowWelcome(true)

    const success = params.has("integration_success")
    const error = params.get("integration_error")
    if (success || error) {
      setActiveTab("integrations")
      setIntegrationBanner(success ? { kind: "success" } : { kind: "error", message: error ?? "" })
      // Strip the flag from the URL. The banner used to be rendered straight off
      // window.location.search, so it reappeared on every reload — announcing a
      // successful connection long after the fact, and even when nothing was connected.
      params.delete("integration_success")
      params.delete("integration_error")
      const qs = params.toString()
      window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname)
    }
  }, [])
```

Change to:

```tsx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setDesiredPlan(params.get("plan"))
    if (params.has("welcome")) setShowWelcome(true)

    const success = params.has("integration_success")
    const error = params.get("integration_error")
    const connect = params.get("connect")
    if (success || error) {
      setActiveTab("integrations")
      setIntegrationBanner(success ? { kind: "success" } : { kind: "error", message: error ?? "" })
    }
    if (connect) {
      setActiveTab("integrations")
      setHighlightConnectorId(connect)
    }
    if (success || error || connect) {
      // Strip one-shot flags from the URL. The banner used to be rendered straight off
      // window.location.search, so it reappeared on every reload — announcing a
      // successful connection long after the fact, and even when nothing was connected.
      // Same reasoning applies to `connect`: it's a one-time entry point, not
      // permanent state tied to the URL.
      params.delete("integration_success")
      params.delete("integration_error")
      params.delete("connect")
      const qs = params.toString()
      window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname)
    }
  }, [])
```

- [ ] **Step 3: Pass `highlightId` to `ConnectorMarketplace`**

Find (around line 743-752):

```tsx
            <ConnectorMarketplace
              connectors={buildCatalog(
                connectedProviders,
                Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
              )}
              theme={DARK_THEME}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
            />
```

Change to:

```tsx
            <ConnectorMarketplace
              connectors={buildCatalog(
                connectedProviders,
                Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
              )}
              theme={DARK_THEME}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
              highlightId={highlightConnectorId}
            />
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 5: Manually verify**

Use this project's `run` skill to start the dev server, sign in, and visit
`/dashboard?connect=trello` (or any real unconnected connector id from
`packages/ui-connectors/src/catalog.ts`). Confirm: the integrations tab is
active on load, the page scrolls to the Trello tile, and the tile shows a
visibly highlighted border/glow. Then confirm the URL no longer shows
`?connect=trello` after the page settles (stripped by the effect).

- [ ] **Step 6: Commit**

```bash
git add apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(landing): support ?connect=<id> deep links to the dashboard"
```

---

### Task 6: Whole-monorepo verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no new errors introduced by this feature (pre-existing warnings
in unrelated files are fine, per this session's earlier `bun run lint`
baseline)

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: PASS, all tasks' tests included, no regressions elsewhere

- [ ] **Step 3: Final commit check**

Run: `git status --short`
Expected: clean (everything from Tasks 1–5 already committed per-task)
