# Spec 10 - Local Memory

## Purpose

Define Yomi's local memory engine: how user preferences, facts, project context, and recent session context are stored, retrieved, updated, and injected into Pro/Max turns.

## Invariants

- Personal memory is local-only and stored under `~/.yomi/`.
- Personal memory is never synced to Neon and is never uploaded to Cloud RAG.
- Explore does not load or write memory.
- Pro and Max can load/write local memory.
- Screenshots, audio, base64 payloads, secrets, and raw media are never persisted to memory.
- Memory retrieval must be bounded before prompt injection.
- Uncertain updates are not allowed to silently overwrite active memories.

## Storage Layout

```text
~/.yomi/
  yomi.md
  memory.db
  memory/
    profile.static.md
    profile.dynamic.md
  sessions/
    YYYY-MM-DD-dev.md
```

`memory.db` is a Bun SQLite database with an FTS index for local retrieval. Markdown profile files are human-readable summaries generated from active memories.

## Memory Model

Memory kinds:

```ts
type MemoryKind =
  | "preference"
  | "fact"
  | "project"
  | "decision"
  | "open_thread"
  | "correction"
```

Memory statuses:

```ts
type MemoryStatus =
  | "active"
  | "superseded"
  | "uncertain"
  | "forgotten"
```

Core fields:

```ts
type MemoryRecord = {
  id: string
  kind: MemoryKind
  scope: string
  topic: string
  content: string
  status: MemoryStatus
  confidence: number
  sourcePath: string | null
  sourceTurnId: string | null
  supersededBy: string | null
  createdAt: string
  updatedAt: string
}
```

## Retrieval

Before a Pro/Max fast-path turn, the sidecar retrieves:

- `~/.yomi/yomi.md`
- static profile
- dynamic profile
- relevant local memories via SQLite FTS/BM25
- recent session tail from today's session log
- optional Cloud RAG snippets if explicitly enabled

Local retrieval is keyword/FTS based in v1. Query terms are sanitized before SQLite `MATCH`, including hyphenated terms, so values like `local-memory-saffron` do not break FTS syntax.

Only active memories with sufficient confidence are injected. Retrieved snippets are capped by character budget before prompt assembly.

## Writing

After a completed Pro/Max turn, the sidecar:

1. Appends a sanitized session turn to `~/.yomi/sessions/YYYY-MM-DD-dev.md`.
2. Calls `captureTurnMemory({ input, output, mode })`.
3. Uses the configured memory extraction model to produce structured memories.
4. Inserts high-confidence memories into SQLite.
5. Refreshes `profile.static.md` and `profile.dynamic.md`.

Extraction rules:

- Store durable preferences, facts, decisions, projects, open threads, and clear corrections.
- Omit one-off trivia.
- Omit uncertain or sensitive content.
- Redact image/audio/base64-like payloads.

## Updates and Forgetting

Clear corrections can supersede older memories by topic. Superseded memories remain in SQLite for traceability but are excluded from normal retrieval.

`forgetLocalMemory(queryOrId)` marks matching memories as `forgotten` and refreshes profiles. Forgotten memories are excluded from retrieval.

## Implemented Files

- `apps/sidecar/src/memory/engine.ts` - SQLite memory engine, extraction, retrieval, profiles, forget/reindex.
- `apps/sidecar/src/memory/session.ts` - session turn log and legacy memory helpers.
- `apps/sidecar/src/memory/cloud-rag.ts` - optional Cloud RAG retrieval client.
- `apps/sidecar/src/harness/prompt.ts` - prompt assembly with local memory sections.
- `apps/sidecar/src/pipeline/fast.ts` - Pro/Max memory load/write integration.

## Future Work

- Local embeddings for semantic recall.
- User-visible memory browser/editor.
- Stronger contradiction confirmation UX.
- Optional encryption at rest for `memory.db` and profile files.
