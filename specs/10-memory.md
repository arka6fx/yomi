# Spec 10 - Local Memory

## Purpose

Define Yomi's local memory engine: how user preferences, facts, project context, and recent session context are stored, retrieved, updated, and injected into Pro/Max turns.

## Invariants

- Personal memory is local-only and stored under `~/.yomi/`.
- Personal memory is never synced to Neon and is never uploaded to a cloud RAG service.
- Cloud RAG mirrors non-personal Yomi archive files and serves them as the primary broad-recall layer.
- Local RAG remains a local fallback/archive index when cloud sync or search is unavailable.
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
    *.md
  projects/<project>/
    context.md
    scratchpad.md
  sessions/
    YYYY-MM-DD-dev.md
```

`memory.db` is a Bun SQLite database with FTS indexes for structured memory retrieval and local archive fallback. Markdown profile files are human-readable summaries generated from active memories.

The sidecar talks to this layer through a narrow memory subsystem facade that loads prompt context, records completed turns, and hides the individual storage backends from the rest of the pipelines.

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
- relevant Cloud RAG snippets mirrored from sessions, project notes, scratchpads, and long memory files
- local archive fallback snippets when cloud retrieval is unavailable
- recent session tail from today's session log

Local retrieval is keyword/FTS based in v1. Query terms are sanitized before SQLite `MATCH`, including hyphenated terms, so values like `local-memory-saffron` do not break FTS syntax.

Only active memories with sufficient confidence are injected. Retrieved snippets are capped by character budget before prompt assembly.

Cloud RAG excludes explicitly personal profile files such as `yomi.md`, `profile.static.md`, and `profile.dynamic.md`. It mirrors larger non-personal context such as old session logs, project notes, long memory files, and historical decisions.

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

- `apps/sidecar/src/memory/subsystem.ts` - subsystem facade for init, context loading, session writes, and memory retrieval.
- `apps/sidecar/src/memory/engine.ts` - SQLite memory engine, extraction, retrieval, profiles, forget/reindex.
- `apps/sidecar/src/memory/cloud-rag.ts` - cloud mirror sync and retrieval for archive files.
- `apps/sidecar/src/memory/local-rag.ts` - local FTS archive index used as fallback and source scanner.
- `apps/sidecar/src/memory/session.ts` - session turn log and legacy memory helpers.
- `apps/sidecar/src/harness/prompt.ts` - prompt assembly with memory sections only; no storage access.
- `apps/sidecar/src/pipeline/fast.ts` / `apps/sidecar/src/pipeline/agent.ts` - Pro/Max memory load/write integration through the subsystem facade.

## Future Work

- Local embeddings for semantic recall.
- User-visible memory browser/editor.
- Stronger contradiction confirmation UX.
- Optional encryption at rest for `memory.db` and profile files.
