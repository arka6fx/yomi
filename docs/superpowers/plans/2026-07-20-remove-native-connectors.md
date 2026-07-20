# Remove Native Connector Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the pre-Composio native implementations for all 10 migrated connectors (gmail, calendar, drive, classroom, tasks, meet, github, notion, slack, linear), plus the now-dead native/Composio switch mechanism, once Notion and Slack (the only two still native in production) are verified working via Composio.

**Architecture:** Every connector's backend `defs/*.ts` file collapses to unconditionally registering its Composio def — the same shape `google-docs.ts`/`google-sheets.ts`/`google-slides.ts`/`google-maps.ts` already use (no native fallback ever existed for those 4). `all-defs.ts` follows suit: every entry becomes `makeComposioXDef(unconfiguredComposioExecutor)` directly, matching the existing placeholder pattern.

**Important architectural correction found during planning:** `ConnectorRegistry`'s `composioDefs` injection (a real, metered Composio executor supplied by `agent/run.ts` via `buildComposioDefs()`) is **not** part of the native/Composio switch being removed — it's the only way agent-core's static, placeholder-executor `ALL_CONNECTOR_DEFS` ever gets a working executor at runtime, and stays load-bearing for every connector, forever. Only the `isComposioBacked()` **gate** on top of that injection (which decided whether to use it) is being removed — once every connector is Composio-only, that gate is always true, so it just always uses the injected def now. `flags.ts`/`isComposioBacked`/`composioBackedConnectors`/`COMPOSIO_CONNECTORS` are still removed entirely (confirmed via full-repo grep: zero callers besides the 10 backend switch files and the mechanism's own definition) — but `composioDefs`/`buildComposioDefs()` and their use in `agent/run.ts` are untouched.

A separate dead Gmail-legacy code path (a `Connector` interface + `ConnectorRegistry.get()` with zero callers anywhere in the repo, confirmed by grep and a live DB check) is removed as part of Gmail's own task.

**Tech Stack:** TypeScript, Bun test runner, Composio REST API (unchanged — only the native side is being removed).

## Global Constraints

- Two-phase rollout: flip `notion`,`slack` into local `COMPOSIO_CONNECTORS` and live-verify both work via Composio BEFORE deleting any native code (Task 1 gates every later task).
- Work connector-by-connector, not as one mass diff — each connector's removal (native file + test + backend switch-file simplification) is independently verifiable via `bun test`.
- `swiggy-def.ts`/`swiggy-def.test.ts` are untouched — no Composio equivalent, permanently native.
- The entire `packages/agent-core/src/connectors/composio/` directory is untouched.
- `mcp-connector.ts` is untouched — still used by `swiggy-def.ts` (verified: not used by `linear-def.ts`, confirmed no other importer besides swiggy and the `index.ts` re-export).
- `getDisplayName` on each backend Composio def object needs no changes and no "equivalence" work — verified that Composio-kind connections use a completely separate, generic `connectionDisplayName()` function in `apps/backend/src/services/composio-connect.ts` (`"Toolkit (Composio)"` / `"Toolkit (connecting…)"`), never `def.getDisplayName` (that's only called from the native-OAuth-only `handleOAuth2Callback` in `apps/backend/src/connectors/executors/oauth2-executor.ts`). No regression is possible either way — just keep each backend file's existing `backendComposioXDef` object verbatim when deleting the native branch.
- `apps/backend/src/routes/integrations.ts` has a real compile-time dependency on `googleGmailDef` (`GOOGLE_SCOPES` sources its scope list from it) that must be fixed (hardcode the literal scopes) when Gmail's native def is deleted — the surrounding `/connect/google` route itself stays (out of scope, deferred per the design spec).
- Out of scope, not touched by any task here: `apps/backend/src/routes/integrations.ts`'s native Google OAuth route (`/connect/google`, `GOOGLE_INTEGRATIONS_CLIENT_ID`/`_SECRET`, `shouldRevokeGoogleGrant`) — flagged as a future follow-up. Production's actual `COMPOSIO_CONNECTORS` env var on the EC2 box is a separate manual operational step after this merges, not part of this code change.
- `bun run typecheck` and `bun run lint` must pass clean after every task, not just at the end (project convention, plus this is a deletion-heavy change where import errors are the main risk).
- Commit messages: Conventional Commits, lowercase, no full stop, max 72 chars (`AGENTS.md`).

---

### Task 1: Verify Notion and Slack work via Composio (local only)

**Files:** `apps/backend/.env` (local, git-ignored — never committed).

- [ ] **Step 1: Add notion and slack to the local COMPOSIO_CONNECTORS list**

Open `apps/backend/.env`, find the `COMPOSIO_CONNECTORS=` line, and add `notion,slack` to the comma-separated list (auth config IDs for both already exist in that file as `COMPOSIO_NOTION_AUTH_CONFIG_ID` and `COMPOSIO_SLACK_AUTH_CONFIG_ID` — nothing else to add).

- [ ] **Step 2: Start the backend dev server**

Run: `cd apps/backend && bun run dev`

- [ ] **Step 3: Live-verify Notion via Composio**

If Notion isn't already connected on your test account, connect it from the dashboard (this re-runs the OAuth flow against the Composio-managed auth config now that the flag is flipped). Then send a message through the agent that requires a real Notion read (e.g. "search my Notion for X") and confirm it returns real results with no errors in the backend logs.

- [ ] **Step 4: Live-verify Slack via Composio**

Same as Step 3, for Slack — reconnect if needed, then ask something that requires a real Slack read (e.g. "what's in my Slack channels" or similar) and confirm real results, no errors.

- [ ] **Step 5: Stop the dev server**

Only proceed to Task 2 once both Step 3 and Step 4 succeeded with no errors. If either fails, stop and investigate — do not proceed to delete any native code while either connector is unverified.

---

### Task 2: Remove native Gmail (+ the dead Gmail-legacy path)

**Files:**
- Delete: `packages/agent-core/src/connectors/google-gmail-def.ts`
- Delete: `packages/agent-core/src/connectors/google-gmail-def.test.ts`
- Delete: `packages/agent-core/src/connectors/google-gmail.ts`
- Modify: `apps/backend/src/connectors/defs/google-gmail.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `apps/backend/src/routes/integrations.ts`
- Modify: `packages/agent-core/src/connectors/registry.ts`
- Modify: `packages/agent-core/src/connectors/types.ts`
- Modify: `apps/backend/src/services/pending-actions.ts`

**Interfaces:** No later task depends on anything this task removes.

- [ ] **Step 1: Delete the native gmail files**

```bash
git rm packages/agent-core/src/connectors/google-gmail-def.ts packages/agent-core/src/connectors/google-gmail-def.test.ts packages/agent-core/src/connectors/google-gmail.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/google-gmail.ts` with:

```ts
import { makeComposioGmailDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGmailDef: BackendConnectorDef = {
  ...makeComposioGmailDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Gmail (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Gmail (${data.email})` : "Gmail (Composio)"
  },
}

registerConnectorDef(backendComposioGmailDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import type { ConnectorDef } from "./connector-def.js"
import { googleGmailDef } from "./google-gmail-def.js"
import { googleCalendarDef } from "./google-calendar-def.js"
```

Replace with:

```ts
import type { ConnectorDef } from "./connector-def.js"
import { makeComposioGmailDef } from "./composio/google-gmail.js"
import { googleCalendarDef } from "./google-calendar-def.js"
```

Find:

```ts
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  googleGmailDef,
  googleCalendarDef,
```

Replace with:

```ts
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  makeComposioGmailDef(unconfiguredComposioExecutor),
  googleCalendarDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { GoogleGmailConnector } from "./connectors/google-gmail.js"
export { googleGmailDef, createGmailTools } from "./connectors/google-gmail-def.js"
```

Delete both lines entirely (no replacement — `makeComposioGmailDef`/`gmailComposioSpecs`/`GMAIL_TOOLKIT` are already exported elsewhere in this file from `./connectors/composio/google-gmail.js`).

- [ ] **Step 5: Fix `integrations.ts`'s dependency on `googleGmailDef`**

Find:

```ts
import { googleGmailDef } from "@yomi/agent-core"
```

Delete this line entirely.

Find:

```ts
// Scope source of truth is the Gmail ConnectorDef — this legacy /connect/google
// route predates the generic /connect/:id path but must request identical scopes.
const GOOGLE_SCOPES = (googleGmailDef.auth.kind === "oauth2" ? googleGmailDef.auth.scopes : []).join(
  " ",
)
```

Replace with:

```ts
// This legacy /connect/google route predates the generic /connect/:id path.
// The scopes below matched the native Gmail ConnectorDef's before it was
// removed (Composio is now the only Gmail path) — keep in sync if this
// route's requested scopes ever need to change.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ")
```

- [ ] **Step 6: Remove the dead `Connector` interface and registry map/get() method**

In `packages/agent-core/src/connectors/types.ts`, find the `Connector` interface (starts with `export interface Connector {`) and delete the entire interface block.

In `packages/agent-core/src/connectors/registry.ts`, find:

```ts
import type { ToolSet } from "ai"
import { GoogleGmailConnector } from "./google-gmail.js"
import { ALL_CONNECTOR_DEFS } from "./all-defs.js"
import type {
  Connector,
  ConnectorStatus,
  TokenProvider,
  ConnectedProvidersLister,
} from "./types.js"
```

Replace with:

```ts
import type { ToolSet } from "ai"
import { ALL_CONNECTOR_DEFS } from "./all-defs.js"
import type {
  ConnectorStatus,
  TokenProvider,
  ConnectedProvidersLister,
} from "./types.js"
```

Find:

```ts
  private connectors = new Map<string, Connector>()
```

Delete this line.

Find:

```ts
    // Legacy Gmail path: stored as "google" in mcp_connections for existing rows.
    // Kept so registry.get("google") still works.
    if (this.connectedProviders.has("google")) {
      this.connectors.set("google", new GoogleGmailConnector(this.userId, this.deps.getAccessToken))
    }

    // Def-based path: iterate all registered ConnectorDefs and load tools for
```

Replace with:

```ts
    // Def-based path: iterate all registered ConnectorDefs and load tools for
```

Find:

```ts
  get(provider: string): Connector | null {
    return this.connectors.get(provider) ?? null
  }

  // Returns all connected provider/def IDs (legacy + def-based).
  getConnected(): string[] {
    return [
      ...new Set([...this.connectors.keys(), ...this.connectedDefIds]),
    ]
  }
```

Replace with:

```ts
  // Returns all connected provider/def IDs.
  getConnected(): string[] {
    return [...this.connectedDefIds]
  }
```

Find:

```ts
  isConnected(provider: string): boolean {
    return this.connectors.has(provider) || this.connectedDefIds.has(provider)
  }
```

Replace with:

```ts
  isConnected(provider: string): boolean {
    return this.connectedDefIds.has(provider)
  }
```

- [ ] **Step 7: Remove the dead replay branch in `pending-actions.ts`**

In `apps/backend/src/services/pending-actions.ts`, find:

```ts
interface GmailSendPayload {
  to: string[]
  subject: string
  body: string
  cc?: string[]
  bcc?: string[]
  replyToMessageId?: string
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function parseGmailSendPayload(payload: unknown): GmailSendPayload {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Gmail payload")
  const p = payload as Record<string, unknown>
  if (!isStringArray(p["to"]) || p["to"].length === 0) throw new Error("Missing Gmail recipients")
  if (typeof p["subject"] !== "string") throw new Error("Missing Gmail subject")
  if (typeof p["body"] !== "string") throw new Error("Missing Gmail body")
  if (p["cc"] !== undefined && !isStringArray(p["cc"])) throw new Error("Invalid Gmail cc")
  if (p["bcc"] !== undefined && !isStringArray(p["bcc"])) throw new Error("Invalid Gmail bcc")
  if (p["replyToMessageId"] !== undefined && typeof p["replyToMessageId"] !== "string") {
    throw new Error("Invalid Gmail reply id")
  }
  return {
    to: p["to"],
    subject: p["subject"],
    body: p["body"],
    cc: p["cc"],
    bcc: p["bcc"],
    replyToMessageId: p["replyToMessageId"],
  }
}

```

Delete this whole block (the `GmailSendPayload` interface, `isStringArray`, and `parseGmailSendPayload` — all three are used only by the branch this step removes, confirmed by grep: zero other callers of `parseGmailSendPayload` or `isStringArray` anywhere in `apps/backend/src`).

Then find:

```ts
  if (row.connector === "google" && row.action === "gmail.sendEmail") {
    const payload = parseGmailSendPayload(row.payload)
    const [{ GoogleGmailConnector }, { getAccessToken }] = await Promise.all([
      import("@yomi/agent-core/connectors/google-gmail"),
      import("./integration-tokens.js"),
    ])
    const gmail = new GoogleGmailConnector(row.userId, getAccessToken)
    const result = await gmail.sendEmail(payload)
    return {
      ok: true,
      messageId: result.messageId,
      threadId: result.threadId,
      message: `Email sent to ${payload.to.join(", ")}.`,
    }
  }

  // Generic connector-tool replay: `action` is the tool key and `payload` the
```

Replace with:

```ts
  // Generic connector-tool replay: `action` is the tool key and `payload` the
```

- [ ] **Step 8: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors. A "Connector not found" or "Cannot find module" error means a step above missed an import site — grep for the offending symbol and fix it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove native gmail connector and dead legacy path"
```

---

### Task 3: Remove native Google Calendar

**Files:**
- Delete: `packages/agent-core/src/connectors/google-calendar-def.ts`
- Delete: `packages/agent-core/src/connectors/google-calendar-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/google-calendar.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/google-calendar-def.ts packages/agent-core/src/connectors/google-calendar-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/google-calendar.ts` with:

```ts
import { makeComposioCalendarDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioCalendarDef: BackendConnectorDef = {
  ...makeComposioCalendarDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Calendar (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Calendar (${data.email})` : "Calendar (Composio)"
  },
}

registerConnectorDef(backendComposioCalendarDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioGmailDef } from "./composio/google-gmail.js"
import { googleCalendarDef } from "./google-calendar-def.js"
import { googleDriveDef } from "./google-drive-def.js"
```

Replace with:

```ts
import { makeComposioGmailDef } from "./composio/google-gmail.js"
import { makeComposioCalendarDef } from "./composio/google-calendar.js"
import { googleDriveDef } from "./google-drive-def.js"
```

Find:

```ts
  makeComposioGmailDef(unconfiguredComposioExecutor),
  googleCalendarDef,
  googleDriveDef,
```

Replace with:

```ts
  makeComposioGmailDef(unconfiguredComposioExecutor),
  makeComposioCalendarDef(unconfiguredComposioExecutor),
  googleDriveDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { googleCalendarDef, createCalendarTools } from "./connectors/google-calendar-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native google calendar connector"
```

---

### Task 4: Remove native Google Drive

**Files:**
- Delete: `packages/agent-core/src/connectors/google-drive-def.ts`
- Delete: `packages/agent-core/src/connectors/google-drive-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/google-drive.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/google-drive-def.ts packages/agent-core/src/connectors/google-drive-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/google-drive.ts` with:

```ts
import { makeComposioDriveDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioDriveDef: BackendConnectorDef = {
  ...makeComposioDriveDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Drive (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Drive (${data.email})` : "Drive (Composio)"
  },
}

registerConnectorDef(backendComposioDriveDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioCalendarDef } from "./composio/google-calendar.js"
import { googleDriveDef } from "./google-drive-def.js"
import { makeComposioDocsDef } from "./composio/google-docs.js"
```

Replace with:

```ts
import { makeComposioCalendarDef } from "./composio/google-calendar.js"
import { makeComposioDriveDef } from "./composio/google-drive.js"
import { makeComposioDocsDef } from "./composio/google-docs.js"
```

Find:

```ts
  makeComposioCalendarDef(unconfiguredComposioExecutor),
  googleDriveDef,
  makeComposioDocsDef(unconfiguredComposioExecutor),
```

Replace with:

```ts
  makeComposioCalendarDef(unconfiguredComposioExecutor),
  makeComposioDriveDef(unconfiguredComposioExecutor),
  makeComposioDocsDef(unconfiguredComposioExecutor),
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { googleDriveDef, createDriveTools } from "./connectors/google-drive-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native google drive connector"
```

---

### Task 5: Remove native Google Classroom

**Files:**
- Delete: `packages/agent-core/src/connectors/google-classroom-def.ts`
- Delete: `packages/agent-core/src/connectors/google-classroom-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/google-classroom.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/google-classroom-def.ts packages/agent-core/src/connectors/google-classroom-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/google-classroom.ts` with:

```ts
import { makeComposioClassroomDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioClassroomDef: BackendConnectorDef = {
  ...makeComposioClassroomDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Classroom (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Classroom (${data.email})` : "Classroom (Composio)"
  },
}

registerConnectorDef(backendComposioClassroomDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioSlidesDef } from "./composio/google-slides.js"
import { googleClassroomDef } from "./google-classroom-def.js"
import { googleTasksDef } from "./google-tasks-def.js"
```

Replace with:

```ts
import { makeComposioSlidesDef } from "./composio/google-slides.js"
import { makeComposioClassroomDef } from "./composio/google-classroom.js"
import { googleTasksDef } from "./google-tasks-def.js"
```

Find:

```ts
  makeComposioSlidesDef(unconfiguredComposioExecutor),
  googleClassroomDef,
  googleTasksDef,
```

Replace with:

```ts
  makeComposioSlidesDef(unconfiguredComposioExecutor),
  makeComposioClassroomDef(unconfiguredComposioExecutor),
  googleTasksDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { googleClassroomDef, createClassroomTools } from "./connectors/google-classroom-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native google classroom connector"
```

---

### Task 6: Remove native Google Tasks

**Files:**
- Delete: `packages/agent-core/src/connectors/google-tasks-def.ts`
- Delete: `packages/agent-core/src/connectors/google-tasks-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/google-tasks.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/google-tasks-def.ts packages/agent-core/src/connectors/google-tasks-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/google-tasks.ts` with:

```ts
import { makeComposioTasksDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioTasksDef: BackendConnectorDef = {
  ...makeComposioTasksDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Tasks (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Tasks (${data.email})` : "Tasks (Composio)"
  },
}

registerConnectorDef(backendComposioTasksDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioClassroomDef } from "./composio/google-classroom.js"
import { googleTasksDef } from "./google-tasks-def.js"
import { googleMeetDef } from "./google-meet-def.js"
```

Replace with:

```ts
import { makeComposioClassroomDef } from "./composio/google-classroom.js"
import { makeComposioTasksDef } from "./composio/google-tasks.js"
import { googleMeetDef } from "./google-meet-def.js"
```

Find:

```ts
  makeComposioClassroomDef(unconfiguredComposioExecutor),
  googleTasksDef,
  googleMeetDef,
```

Replace with:

```ts
  makeComposioClassroomDef(unconfiguredComposioExecutor),
  makeComposioTasksDef(unconfiguredComposioExecutor),
  googleMeetDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { googleTasksDef, createTasksTools } from "./connectors/google-tasks-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native google tasks connector"
```

---

### Task 7: Remove native Google Meet

**Files:**
- Delete: `packages/agent-core/src/connectors/google-meet-def.ts`
- Delete: `packages/agent-core/src/connectors/google-meet-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/google-meet.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/google-meet-def.ts packages/agent-core/src/connectors/google-meet-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/google-meet.ts` with:

```ts
import { makeComposioMeetDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioMeetDef: BackendConnectorDef = {
  ...makeComposioMeetDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Meet (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Meet (${data.email})` : "Meet (Composio)"
  },
}

registerConnectorDef(backendComposioMeetDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioTasksDef } from "./composio/google-tasks.js"
import { googleMeetDef } from "./google-meet-def.js"
import { githubDef } from "./github-def.js"
```

Replace with:

```ts
import { makeComposioTasksDef } from "./composio/google-tasks.js"
import { makeComposioMeetDef } from "./composio/google-meet.js"
import { githubDef } from "./github-def.js"
```

Find:

```ts
  makeComposioTasksDef(unconfiguredComposioExecutor),
  googleMeetDef,
  makeComposioMapsDef(unconfiguredComposioExecutor),
```

Replace with:

```ts
  makeComposioTasksDef(unconfiguredComposioExecutor),
  makeComposioMeetDef(unconfiguredComposioExecutor),
  makeComposioMapsDef(unconfiguredComposioExecutor),
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { googleMeetDef, createMeetTools } from "./connectors/google-meet-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native google meet connector"
```

---

### Task 8: Remove native GitHub

**Files:**
- Delete: `packages/agent-core/src/connectors/github-def.ts`
- Delete: `packages/agent-core/src/connectors/github-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/github.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

Note: `apps/backend/src/connectors/defs/github.test.ts` (a separate, 767-line backend-level test) is NOT deleted by this task — it tests the backend `defs/github.ts` file's behavior, which still exists after this change (simplified, not removed). Only re-run it in Step 5 to confirm it still passes against the simplified file; if it specifically asserts native-vs-composio switching behavior, that assertion will need updating — read the test file first if Step 5 fails.

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/github-def.ts packages/agent-core/src/connectors/github-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/github.ts` with:

```ts
import { makeComposioGitHubDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGitHubDef: BackendConnectorDef = {
  ...makeComposioGitHubDef(createComposioRestExecutor()),
  getDisplayName: async () => "GitHub (Composio)",
}

registerConnectorDef(backendComposioGitHubDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioMeetDef } from "./composio/google-meet.js"
import { githubDef } from "./github-def.js"
import { notionDef } from "./notion-def.js"
```

Replace with:

```ts
import { makeComposioMeetDef } from "./composio/google-meet.js"
import { makeComposioGitHubDef } from "./composio/github.js"
import { notionDef } from "./notion-def.js"
```

Find:

```ts
  makeComposioMapsDef(unconfiguredComposioExecutor),
  githubDef,
  notionDef,
```

Replace with:

```ts
  makeComposioMapsDef(unconfiguredComposioExecutor),
  makeComposioGitHubDef(unconfiguredComposioExecutor),
  notionDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { githubDef, createGitHubTools } from "./connectors/github-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors. If `apps/backend/src/connectors/defs/github.test.ts` fails specifically on a native-vs-composio assertion, read that test file, update the failing assertion(s) to match the now-composio-only behavior, and re-run.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native github connector"
```

---

### Task 9: Remove native Notion

**Files:**
- Delete: `packages/agent-core/src/connectors/notion-def.ts`
- Delete: `packages/agent-core/src/connectors/notion-def.test.ts`
- Modify: `apps/backend/src/connectors/defs/notion.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Delete the native files**

```bash
git rm packages/agent-core/src/connectors/notion-def.ts packages/agent-core/src/connectors/notion-def.test.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/notion.ts` with:

```ts
import { makeComposioNotionDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioNotionDef: BackendConnectorDef = {
  ...makeComposioNotionDef(createComposioRestExecutor()),
  getDisplayName: async () => "Notion (Composio)",
}

registerConnectorDef(backendComposioNotionDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioGitHubDef } from "./composio/github.js"
import { notionDef } from "./notion-def.js"
import { slackDef } from "./slack-def.js"
```

Replace with:

```ts
import { makeComposioGitHubDef } from "./composio/github.js"
import { makeComposioNotionDef } from "./composio/notion.js"
import { slackDef } from "./slack-def.js"
```

Find:

```ts
  makeComposioGitHubDef(unconfiguredComposioExecutor),
  notionDef,
  slackDef,
```

Replace with:

```ts
  makeComposioGitHubDef(unconfiguredComposioExecutor),
  makeComposioNotionDef(unconfiguredComposioExecutor),
  slackDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { notionDef, createNotionTools } from "./connectors/notion-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native notion connector"
```

---

### Task 10: Remove native Slack

**Files:**
- Delete: `packages/agent-core/src/connectors/slack-def.ts`
- Modify: `apps/backend/src/connectors/defs/slack.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

Note: no `slack-def.test.ts` exists to delete (confirmed during design). `apps/backend/src/connectors/defs/slack.test.ts` exists but its suite is already `describe.skip`'d — leave it as-is (re-run in Step 5 only to confirm it doesn't error at parse time).

- [ ] **Step 1: Delete the native file**

```bash
git rm packages/agent-core/src/connectors/slack-def.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/slack.ts` with:

```ts
import { makeComposioSlackDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioSlackDef: BackendConnectorDef = {
  ...makeComposioSlackDef(createComposioRestExecutor()),
  getDisplayName: async () => "Slack (Composio)",
}

registerConnectorDef(backendComposioSlackDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioNotionDef } from "./composio/notion.js"
import { slackDef } from "./slack-def.js"
import { linearDef } from "./linear-def.js"
```

Replace with:

```ts
import { makeComposioNotionDef } from "./composio/notion.js"
import { makeComposioSlackDef } from "./composio/slack.js"
import { linearDef } from "./linear-def.js"
```

Find:

```ts
  makeComposioNotionDef(unconfiguredComposioExecutor),
  slackDef,
  linearDef,
```

Replace with:

```ts
  makeComposioNotionDef(unconfiguredComposioExecutor),
  makeComposioSlackDef(unconfiguredComposioExecutor),
  linearDef,
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { slackDef, createSlackTools } from "./connectors/slack-def.js"
```

Delete this line entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native slack connector"
```

---

### Task 11: Remove native Linear

**Files:**
- Delete: `packages/agent-core/src/connectors/linear-def.ts`
- Modify: `apps/backend/src/connectors/defs/linear.ts`
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

Note: no `linear-def.test.ts` exists to delete. `apps/backend/src/connectors/defs/linear.test.ts` exists but its suite is already `describe.skip`'d — same treatment as Slack's. Confirmed during design: `linear-def.ts` does NOT import `mcp-connector.ts` — that file stays untouched (still used by `swiggy-def.ts`).

- [ ] **Step 1: Delete the native file**

```bash
git rm packages/agent-core/src/connectors/linear-def.ts
```

- [ ] **Step 2: Simplify the backend switch file**

Replace the full contents of `apps/backend/src/connectors/defs/linear.ts` with:

```ts
import { makeComposioLinearDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioLinearDef: BackendConnectorDef = {
  ...makeComposioLinearDef(createComposioRestExecutor()),
  getDisplayName: async () => "Linear (Composio)",
}

registerConnectorDef(backendComposioLinearDef)
```

- [ ] **Step 3: Update `all-defs.ts`**

Find:

```ts
import { makeComposioSlackDef } from "./composio/slack.js"
import { linearDef } from "./linear-def.js"
import { swiggyDef } from "./swiggy-def.js"
```

Replace with:

```ts
import { makeComposioSlackDef } from "./composio/slack.js"
import { makeComposioLinearDef } from "./composio/linear.js"
import { swiggyDef } from "./swiggy-def.js"
```

Find:

```ts
  makeComposioSlackDef(unconfiguredComposioExecutor),
  linearDef,
  swiggyDef,
]
```

Replace with:

```ts
  makeComposioSlackDef(unconfiguredComposioExecutor),
  makeComposioLinearDef(unconfiguredComposioExecutor),
  swiggyDef,
]
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export {
  linearDef,
  createLinearTools,
} from "./connectors/linear-def.js"
```

Delete these lines entirely.

- [ ] **Step 5: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove native linear connector"
```

---

### Task 12: Remove the native/Composio switch mechanism

**Files:**
- Delete: `packages/agent-core/src/connectors/composio/flags.ts`
- Delete: `packages/agent-core/src/connectors/composio/registry-selection.test.ts`
- Modify: `packages/agent-core/src/connectors/registry.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `.env.example` (repo root)
- Modify: `apps/backend/.env` (local only, not committed)

By this point, all 10 backend `defs/*.ts` files register their Composio def unconditionally — nothing calls `isComposioBacked()` or reads `COMPOSIO_CONNECTORS` anymore except the switch mechanism itself.

- [ ] **Step 1: Confirm nothing still references the switch mechanism**

Run: `grep -rn "isComposioBacked\|composioBackedConnectors\|COMPOSIO_CONNECTORS" apps/backend/src packages/agent-core/src --include="*.ts"`
Expected: matches only inside `packages/agent-core/src/connectors/composio/flags.ts` (its own definition), `packages/agent-core/src/connectors/registry.ts` (the composioDefs indirection being removed in this task), `packages/agent-core/src/index.ts` (the re-export), and `.env`/`.env.example`. If any backend `defs/*.ts` file still shows up, Task 2-11 missed simplifying it — go back and fix that file before continuing.

- [ ] **Step 2: Delete the flag file and its test**

```bash
git rm packages/agent-core/src/connectors/composio/flags.ts packages/agent-core/src/connectors/composio/registry-selection.test.ts
```

- [ ] **Step 3: Drop the `isComposioBacked` gate in `registry.ts`'s `buildConnectors()` — keep the `composioDefs` override itself**

`composioDefs` (injected by `agent/run.ts` via `buildComposioDefs()`) is NOT being removed — it's the only way `ALL_CONNECTOR_DEFS`'s placeholder-executor defs ever get a real, working executor. Only the flag *gating* whether to use it goes away, since every connector now always needs it.

In `packages/agent-core/src/connectors/registry.ts`, find the `buildConnectors()` method's def-iteration loop:

```ts
    // Def-based path: iterate all registered ConnectorDefs and load tools for
    // any that the user has connected (provider key matches mcp_connections row).
    for (const baseDef of ALL_CONNECTOR_DEFS) {
      // Per-connector backend selection: prefer the injected Composio def when the
      // connector is flagged, else keep the native (hand-rolled) def.
      const composioDef = this.deps.composioDefs?.[baseDef.id]
      const def = composioDef && isComposioBacked(baseDef.id) ? composioDef : baseDef

      if (this.deps.excludeNodeOnly && def.requiresNodeRuntime) {
        if (this.connectedProviders.has(def.id)) this.desktopOnlyNames.push(def.name)
        continue
      }
      if (this.connectedProviders.has(def.id)) {
        this.connectedDefIds.add(def.id)
        if (def.isMCPBased && def.connectMCP) {
          // MCP defs: store for lazy loading, don't call tools() yet
          this.mcpConnectedIds.push(def.id)
        } else {
          const tools = def.tools({
            userId: this.userId,
            getAccessToken: this.deps.getAccessToken,
            createPendingAction: this.deps.createPendingAction,
          })
          Object.assign(this.defTools, tools)
        }
      }
    }
```

Replace with:

```ts
    // Def-based path: iterate all registered ConnectorDefs and load tools for
    // any that the user has connected (provider key matches mcp_connections row).
    for (const baseDef of ALL_CONNECTOR_DEFS) {
      // Every connector is Composio-backed now — ALL_CONNECTOR_DEFS only ever
      // holds a placeholder executor (agent-core has no real API key), so the
      // injected composioDefs entry (a real, metered executor from the backend)
      // is always preferred when present.
      const def = this.deps.composioDefs?.[baseDef.id] ?? baseDef

      if (this.deps.excludeNodeOnly && def.requiresNodeRuntime) {
        if (this.connectedProviders.has(def.id)) this.desktopOnlyNames.push(def.name)
        continue
      }
      if (this.connectedProviders.has(def.id)) {
        this.connectedDefIds.add(def.id)
        if (def.isMCPBased && def.connectMCP) {
          // MCP defs: store for lazy loading, don't call tools() yet
          this.mcpConnectedIds.push(def.id)
        } else {
          const tools = def.tools({
            userId: this.userId,
            getAccessToken: this.deps.getAccessToken,
            createPendingAction: this.deps.createPendingAction,
          })
          Object.assign(this.defTools, tools)
        }
      }
    }
```

Then find the `isComposioBacked` import line at the top of the file (e.g. `import { isComposioBacked } from "./composio/flags.js"`) and delete it. Do NOT touch the `composioDefs` field on `ConnectorRegistryDeps` beyond updating its comment — find:

```ts
  // Composio-backed defs keyed by connector id, injected by the host (the backend
  // wires each with a real Composio executor). A connector here is used ONLY when
  // it is also flagged via COMPOSIO_CONNECTORS; otherwise the native def in
  // ALL_CONNECTOR_DEFS is kept. This is the per-connector native↔composio switch.
  composioDefs?: Record<string, ConnectorDef>
```

Replace with:

```ts
  // Composio-backed defs keyed by connector id, injected by the host (the backend
  // wires each with a real, metered Composio executor). Every connector is
  // Composio-only now — ALL_CONNECTOR_DEFS itself only ever holds a placeholder
  // executor, since agent-core has no real API key — so this map is always used
  // when present, for every connector, not gated by any flag.
  composioDefs?: Record<string, ConnectorDef>
```

- [ ] **Step 4: Update `index.ts`**

Find:

```ts
export { isComposioBacked, composioBackedConnectors } from "./connectors/composio/flags.js"
```

Delete this line entirely.

- [ ] **Step 5: Remove `COMPOSIO_CONNECTORS` from env documentation**

In `.env.example` (repo root), find:

```
# Comma-separated list of connector ids served by Composio (instead of native).
# Google entries require a BYO auth config pointing at Yomi's own OAuth client —
# do not flip them in prod until the Google verification / redirect-URI work is done.
COMPOSIO_CONNECTORS=linear,github,slack,notion,google,google-calendar,google-drive,google-docs,google-sheets,google-slides,google-classroom,google-tasks,google-meet
```

Delete these 4 lines entirely (every connector is unconditionally Composio-backed now — there's nothing left to list).

Find:

```
# Google connector auth config IDs (fill if any are in COMPOSIO_CONNECTORS)
```

Replace with:

```
# Google connector auth config IDs (all required — every Google connector is Composio-only)
```

In `apps/backend/.env` (local, not committed), find the corresponding `COMPOSIO_CONNECTORS=...` line (holding your local list of flagged connectors, now including `notion,slack` from Task 1) and delete it the same way — this file no longer needs it since every connector is unconditionally Composio-backed now.

- [ ] **Step 6: Run typecheck and the full suite**

Run: `bun run typecheck && bun run test` (from repo root)
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove dead native/composio switch mechanism"
```

---

### Task 13: Final manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite, typecheck, and lint one more time**

Run: `bun run test && bun run typecheck && bun run lint` (from repo root)
Expected: all pass clean, only pre-existing unrelated warnings (if any).

- [ ] **Step 2: Start the dev backend and dashboard**

Run: `cd apps/backend && bun run dev` and `cd apps/landing && bun run dev` in separate terminals/background processes.

- [ ] **Step 3: Spot-check the dashboard connector list**

Open the dashboard, check that all 10 previously-native connectors (Gmail, Calendar, Drive, Classroom, Tasks, Meet, GitHub, Notion, Slack, Linear) still show up in the connector list with correct icons and names, and that any already-connected ones (from before this change) still show as connected with a sensible display name.

- [ ] **Step 4: Verify the agent still works end-to-end for at least one previously-native connector**

Ask the agent to do something that requires a real tool call against one of the 10 (e.g. "what's on my calendar today", "search my Gmail for X") and confirm it works with no errors.

- [ ] **Step 5: Fix any issues found, then re-run Step 1**

If Step 3 or 4 surfaces a bug, fix it in the relevant file from Tasks 2-12, re-run the full verification, and re-check before proceeding.

- [ ] **Step 6: Final commit (only if Step 5 required changes)**

```bash
git add -A
git commit -m "fix: address manual verification findings on connector cleanup"
```

If Steps 3-4 passed with no changes needed, skip this commit — Task 12's commit is the last one.
