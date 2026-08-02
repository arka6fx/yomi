# RAG ingestion beyond Drive — sub-item 1: raw text (`index_text`) — design

Status: approved
Date: 2026-08-03
Backlog ref: `docs/agentic-backlog.md` item 10

## Problem

RAG only ever gets content from Drive sync (`services/rag/drive-*`). The
backend already has generic ingestion infrastructure (`indexDocument()` in
`services/rag/index-document.ts`) and an unused manual REST endpoint
(`POST /rag/documents`), but nothing in the chat surface lets a user say
"remember this" and have arbitrary pasted text land in the same
`rag_documents`/`rag_chunks` pipeline that `rag_search` (item 5's
deep-research tool) and passive RAG injection both read from.

This is the first of three sub-items decomposed from backlog item 10 (the
other two are URL ingestion and PDF/uploaded-document ingestion — separate
specs). Scoped narrowly: a single new agent-callable tool, reusing
`indexDocument()` as-is.

## Goal

An `index_text` tool the backend agent can call when a user pastes text and
asks Yomi to remember/index it, storing it in the user's cloud RAG archive
so it becomes searchable via `rag_search` (item 5) and future passive RAG
injection — gated by the same consent and plan checks the existing `/rag/*`
REST routes already enforce.

## Non-goals

- Any UI. Per the "agent-tool-driven" scoping decision for backlog item 10,
  there is no landing/dashboard surface for this — chat is the only
  trigger. A future dashboard (possibly backlog item 7 or later) can reuse
  the same backend service functions.
- Refactoring the existing (currently unused) `POST /rag/documents` REST
  route. It duplicates `indexDocument()`'s chunk/embed logic inline with
  slightly different conflict handling; left untouched since nothing calls
  it and touching it risks an unrelated regression for zero benefit here.
- URL and PDF ingestion — separate specs.

## Gating

Two checks, both required, checked before any write:

1. **Consent** — `checkConsent(userId, "cloud_memory")`, the same consent
   type `/rag/*` REST routes require via `requireConsent("cloud_memory")`
   and the same one item 5's `deep_research` fix gates `ragSearch`/
   `fetchRagContext` on. `index_text` writes into the same tables `rag_search`
   reads from, so it must be gated identically — this is the exact class of
   bug the item 5 security fix caught, applied proactively here instead of
   discovered in review.
2. **Plan** — the same Pro/Max/owner check `ragAllowed()` enforces in
   `routes/rag.ts` (`effectivePlanForUser(user) === "pro" | "max"` or
   `isOwnerUser(user)`). Cloud RAG is a paid-plan feature at the REST layer;
   an agent tool must not be a side door around that gate for an Explore
   user.

Both denials return `{ error: <reason> }` (never throw), consistent with
`delegate`/`deep_research`'s cap-exceeded convention — the model sees why
and can tell the user, rather than the turn silently failing.

## Source/document keying

- **Source:** one persistent per-user `ragSources` row, get-or-created
  idempotently on first use: `sourceType: "manual"` (new constant
  `MANUAL_SOURCE_TYPE = "manual"`, matching the `DRIVE_SOURCE_TYPE =
  "google-drive"` pattern in `drive-sync.ts`), `name: "Chat notes"`. Every
  subsequent `index_text` call for that user reuses the same source row.
- **Document:** each call creates a *new* document under that source,
  keyed by a fresh `crypto.randomUUID()` as `externalId` — never a
  title-derived key. This means repeated pastes (even with the same title)
  never silently overwrite an earlier one; `indexDocument()`'s own
  content-hash check still dedupes a true no-op re-paste of identical text
  under the same `externalId` (which can't happen here since `externalId`
  is always fresh, but the hash check remains as defense-in-depth if this
  function is ever called a second time with the same random id, e.g. a
  retried tool call).

## Interface

New file: `packages/agent-core/src/index-text.ts`, following the
`createRagSearchTool`/`createMemorySearchTool` shape in `deep-research.ts`
(agent-core factory wraps an injected backend callback; agent-core itself
never touches `@yomi/db`):

```ts
export type IndexTextResult = { ok: true; documentId: string } | { error: string }
export type IndexTextFn = (title: string, content: string) => Promise<IndexTextResult>

export function createIndexTextTool(indexText: IndexTextFn) {
  return tool({
    description:
      "Index a piece of text into the user's searchable cloud archive so it can be " +
      "found later by rag_search or the deep_research tool. Use this when the user " +
      "pastes text and asks you to remember, save, or index it.",
    parameters: z.object({
      title: z.string().min(1).max(200).describe("A short, descriptive title for this content"),
      content: z.string().min(1).max(100_000).describe("The text to index"),
    }),
    execute: async ({ title, content }) => indexText(title, content),
  })
}
```

**Backend callback**, `apps/backend/src/services/rag/manual-source.ts`:

```ts
export const MANUAL_SOURCE_TYPE = "manual"
const MANUAL_SOURCE_NAME = "Chat notes"

async function ensureManualSource(userId: string): Promise<string> {
  // get-or-create, matching findSource()'s lookup shape in routes/rag.ts
}

export async function indexManualText(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  const consent = await checkConsent(userId, "cloud_memory")
  if (!consent.allowed) return { error: "cloud memory consent not granted" }
  // plan check (ragAllowed-equivalent) — see Open Questions on where this check
  // resolves the user record from, since this function only receives userId

  const sourceId = await ensureManualSource(userId)
  const result = await indexDocument({
    userId,
    sourceId,
    externalId: crypto.randomUUID(),
    title: clean(title, 200),
    mimeType: "text/plain",
    text: content,
  })
  if (result.status === "unchanged" || !result.documentId) {
    return { error: "failed to index" }
  }
  return { ok: true, documentId: result.documentId }
}
```

**Wiring**, `apps/backend/src/agent/run.ts`: constructed alongside
`delegateTool`/`deepResearchTool` and added as `index_text:` in the
`extraTools` object passed to the top-level `runAgentLoop` call.

## Open question resolved: where the plan check happens

`runAgent()` in `run.ts` already has the full `user` record in scope
(fetched via `fetchUser` near the top of the function, same one
`effectivePlanForUser(user)` is called on elsewhere in that file for model
selection). Rather than have `indexManualText` re-fetch the user or take a
plan string as a parameter, the plan check happens in `run.ts` at tool
construction time, mirroring `ragAllowed()`'s exact logic — the tool is
only added to `extraTools` at all when the user's plan qualifies:

```ts
const canUseRag = isOwnerUser(user) || effectivePlanForUser(user) === "pro" || effectivePlanForUser(user) === "max"
// ...
extraTools: {
  // ...
  ...(canUseRag ? { index_text: createIndexTextTool((title, content) => indexManualText(opts.userId, title, content)) } : {}),
},
```

This means an Explore-plan user never sees `index_text` in their tool set
at all (cleaner than the tool existing and always erroring), while the
consent check still lives inside `indexManualText` itself since consent
(unlike plan) can change turn-to-turn without a new deploy and the function
should be safe to call standalone. `effectivePlanForUser` is already
imported in `run.ts` (line 34, used elsewhere in the same file for model
selection); `isOwnerUser` is not — it needs a new import from
`../entitlements.js` (the same module `routes/rag.ts` imports it from),
added to that existing import line.

## Error handling

- Consent/plan denial: `{ error: string }`, never throws (see Gating).
- `indexDocument()` internally does not catch — a DB failure during
  chunk/embed insert would throw. `indexManualText` wraps the call in
  try/catch, returning `{ error: "failed to index" }` on any exception —
  same degrade-gracefully-never-throw contract the other agent tools
  settled on after item 5's final review (an uncaught throw from
  `execute` kills the whole parent turn).

## Testing

- `packages/agent-core/src/index-text.test.ts`: tool shape, calls the
  injected `indexText` callback with `(title, content)`, passes through
  its return value unchanged (both the `{ ok }` and `{ error }` shapes).
- `apps/backend/src/services/rag/manual-source.test.ts`: `ensureManualSource`
  creates a source on first call and reuses it on a second call for the
  same user (same `sourceId` both times); `indexManualText` returns
  `{ error }` when consent is denied without calling `indexDocument`;
  returns `{ error }` on an `indexDocument` throw; returns `{ ok,
  documentId }` on success with a fresh `externalId` per call (two calls
  with identical title/content produce two distinct `documentId`s, proving
  the random-`externalId` no-overwrite guarantee).
- `apps/backend/src/agent/run.test.ts`: a wiring test proving `index_text`
  is present in `extraTools` for a Pro-plan user and absent for an
  Explore-plan user, mirroring the plan-gate logic exactly (not just
  "exists with a function," given the plan-gate is the security-relevant
  part here).
