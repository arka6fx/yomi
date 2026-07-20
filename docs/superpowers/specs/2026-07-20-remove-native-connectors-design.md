# Remove Pre-Composio Native Connector Code — Design

Date: 2026-07-20
Status: Approved (design); pending implementation plan

## Summary

Yomi migrated its connectors to run through Composio (Gmail, Calendar,
Drive, Classroom, Tasks, Meet, GitHub, Notion, Slack, Linear), but kept the
original hand-rolled implementations side by side as a per-connector
rollback safety net (`COMPOSIO_CONNECTORS` env flag + `isComposioBacked()`
switch in `packages/agent-core/src/connectors/registry.ts`). 8 of the 10
are already Composio-flagged in production; Notion and Slack are the only
two still running native. This removes the native implementations for all
10, and the now-dead switch mechanism itself, once nothing branches on it
anymore.

Swiggy (`swiggy-def.ts`) is untouched — it has no Composio equivalent and
is permanently native.

Out of scope for this round, flagged as a follow-up: `apps/backend/src/routes/integrations.ts`'s
native Google OAuth flow (`/connect/google` route,
`GOOGLE_INTEGRATIONS_CLIENT_ID`/`_SECRET`, `shouldRevokeGoogleGrant`)
becomes dead once no native Google connector ever holds the shared OAuth
grant — but removing an OAuth route is a bigger, separate cut than removing
connector implementations, and deserves its own review rather than being
folded into this cleanup.

## Two-phase rollout

**Phase 1 — flip Notion and Slack to Composio, verify, before deleting
anything.** Both already have Composio auth configs provisioned
(`COMPOSIO_NOTION_AUTH_CONFIG_ID`, `COMPOSIO_SLACK_AUTH_CONFIG_ID` already
set in `apps/backend/.env`) — just not yet in the `COMPOSIO_CONNECTORS`
list. This is local-only verification; production's actual environment
(the EC2 box) is a separate, later manual step outside this round's scope
(the user or a follow-up session flips it there once this code change is
merged and confirmed).

**Phase 2 — delete native code, connector-by-connector, not as one mass
diff.** Each connector's removal (native def file + its test + the backend
switch-file simplification) is independently verifiable via `bun test`, so
a mistake in one connector's removal doesn't hide inside a giant diff.
Shared-infrastructure removal (the switch mechanism itself, the dead
Gmail-legacy path, `registry-selection.test.ts`) happens last, once every
connector's switch file no longer references any of it.

## Architecture

Every connector's backend `apps/backend/src/connectors/defs/*.ts` file
collapses to the same shape `google-docs.ts`/`google-sheets.ts`/
`google-slides.ts`/`google-maps.ts` already use today — unconditionally
registering the Composio def, no `isComposioBacked(id) ? composioDef :
nativeDef` ternary. `packages/agent-core/src/connectors/all-defs.ts`
follows suit: every entry becomes `makeComposioXDef(executor)` directly,
so the `unconfiguredComposioExecutor` placeholder pattern (currently only
used by docs/sheets/slides/maps, which never had a native fallback) becomes
universal across all 14 Composio-backed connectors.

## File-by-file impact

**Delete outright** (native implementation + its test, for each of the 10
migrated connectors):
- `packages/agent-core/src/connectors/google-gmail-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/google-gmail.ts` (`GoogleGmailConnector`
  — the one wrapper/API-client file among the native defs; verified dead
  once the def itself goes, see below)
- `packages/agent-core/src/connectors/google-calendar-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/google-drive-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/google-classroom-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/google-tasks-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/google-meet-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/github-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/notion-def.ts` + `.test.ts`
- `packages/agent-core/src/connectors/slack-def.ts` (no dedicated
  agent-core test exists — only a backend-level test that's already
  `describe.skip`'d)
- `packages/agent-core/src/connectors/linear-def.ts` (same — no dedicated
  agent-core test; backend-level test already `describe.skip`'d)

**Simplify** (10 backend switch files in `apps/backend/src/connectors/defs/`):
drop the native import and the `isComposioBacked` ternary, register the
Composio def directly. For each, verify `getDisplayName` (or equivalent)
has a working Composio-backed replacement — Composio's REST API exposes
connected-account metadata per toolkit; each connector's native
`getDisplayName` (typically a native OAuth userinfo/profile call) needs an
equivalent lookup against that data so the dashboard's "connected as
&lt;account&gt;" display doesn't regress. This is checked individually per
connector during implementation, not assumed uniform.

**Remove the switch mechanism itself**, once every connector's backend
file no longer references it:
- `packages/agent-core/src/connectors/composio/flags.ts`
  (`isComposioBacked`/`composioBackedConnectors`) — delete the file if
  nothing else imports from it
- The `composioDefs` override indirection in
  `packages/agent-core/src/connectors/registry.ts`'s `buildConnectors()` —
  collapses to iterating `ALL_CONNECTOR_DEFS` directly with no per-def
  native/Composio branch
- `COMPOSIO_CONNECTORS` — removed from `.env`/`.env.example` documentation

**Remove the dead Gmail-legacy path** (verified via direct DB query — zero
`pending_actions` rows currently have `connector="google" AND
action="gmail.sendEmail"` — and a full-repo grep — zero callers of
`registry.get(...)` anywhere in `apps/` or `packages/agent-core`):
- The `Connector` interface in
  `packages/agent-core/src/connectors/types.ts` (implemented only by
  `GoogleGmailConnector`, which is being deleted)
- `ConnectorRegistry`'s `connectors: Map<string, Connector>` field, its
  `get(provider)` method, and the special-cased `if
  (this.connectedProviders.has("google")) { this.connectors.set("google",
  new GoogleGmailConnector(...)) }` block in `registry.ts`
- The `gmail.sendEmail` legacy replay branch in
  `apps/backend/src/services/pending-actions.ts:196-204`

**Delete**: `packages/agent-core/src/connectors/composio/registry-selection.test.ts`
— this test's entire premise (verifying the native↔Composio switch
generically, using Linear as its example connector) disappears once the
switch mechanism is gone. There's nothing left at that seam to test.

**Verify before assuming reusable**: `mcp-connector.ts` — Linear's native
def uses this shared MCP-connection helper; confirm during implementation
whether anything else still needs it once Linear's native def is deleted,
rather than assuming it's still load-bearing or assuming it's now dead.

**Untouched**:
- `swiggy-def.ts` + `swiggy-def.test.ts` (no Composio equivalent,
  permanently native)
- The entire `packages/agent-core/src/connectors/composio/` directory (all
  14 Composio implementations, unaffected by this cleanup)
- `connector-def.ts`, `types.ts`'s non-`Connector` exports (`ConnectorDef`,
  `ToolFactory`, etc. — still the core abstraction every remaining
  Composio-backed def implements)

## Testing

Full suite + typecheck + lint after every connector's removal, not only
at the end — a deletion-heavy change is where "something still imported
that" mistakes hide easiest, and per-step verification catches them
immediately rather than at the end of a mass diff. No new automated tests
are added (this removes coverage for deleted code, it doesn't add new
behavior) — the one exception is the `getDisplayName` equivalence check
per connector during Phase 1's live verification, done manually/via a
quick script against real Composio connected-account data, not as a new
permanent test.

## Future (explicitly deferred)

`apps/backend/src/routes/integrations.ts`'s native Google OAuth flow
(`/connect/google` route, `GOOGLE_INTEGRATIONS_CLIENT_ID`/`_SECRET`,
`shouldRevokeGoogleGrant`) — becomes dead once no native Google connector
ever holds the shared grant, but removing an OAuth route is a bigger,
separate decision than removing connector implementations. Flagged for a
future round, not touched here. Production's actual `COMPOSIO_CONNECTORS`
env var on the EC2 box also needs manually flipping to include
`notion,slack` at some point after this merges — a deploy-adjacent
operational step, not part of this code change.
