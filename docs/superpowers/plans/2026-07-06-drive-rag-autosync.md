# Google Drive → RAG Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuously index user-selected Google Drive folders into Yomi's existing backend RAG store so the agent can semantically search the user's own documents.

**Architecture:** Backend-owned pipeline (Cloudflare Worker). The backend fetches Drive content via `getAccessToken(userId, "google-drive")`, extracts text, and reuses the existing chunk → embed → store path. An initial batched backfill seeds the index; the Worker's existing every-minute `scheduled()` handler drives incremental sync via the Drive Changes API. The desktop only calls source-CRUD routes to pick folders.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle + Neon (`neon()` HTTP mode), `bun:test`, AI Credits embeddings (`text-embedding-3-small`, 1536-d).

## Global Constraints

- **Runtime:** Cloudflare Workers. Use `neon()` HTTP mode via the existing `db` from `@yomi/db` — never `Pool`. Do not store Request/Response/stream refs at module scope. Do not pass a cached promise into `ctx.waitUntil()` across requests.
- **Embeddings:** model `text-embedding-3-small`, exactly `1536` dimensions. Reuse the existing `embedText`/`chunkText` helpers — do not re-implement.
- **Dedup key:** a document's identity is `(source_id, external_id)`; its freshness is `content_hash = hash(external_id + "\0" + text)`. Re-indexing unchanged content must be a no-op.
- **Access gate:** every Drive-sync route is `authenticate` + `requireConsent("cloud_memory")` + `ragAllowed(user)` (Pro required), matching `routes/rag.ts`.
- **File types (v1):** Google Docs → `text/plain`, Sheets → `text/csv`, Slides → `text/plain`; plus `text/*` and `application/json` downloaded directly. Everything else is skipped and counted, never indexed.
- **Folder recursion (v1):** direct children only.
- **Commits:** one-time exception granted for the `feat/drive-rag-autosync` branch only — subagents DO commit their work per task on this branch (never on `main`). Each task's final step is a real `git commit` with a conventional-commit message.
- **Test command:** `cd apps/backend && bun test <path>`; typecheck with `bun run typecheck`.

---

## File Structure

- `packages/db/src/schema.ts` — add `sync_state` to `ragSources`, `external_id` (+ index) to `ragDocuments`.
- `packages/db/drizzle/<next>_drive_rag_sync.sql` — migration.
- `apps/backend/src/services/rag/embeddings.ts` — **new**; extracted `embedText`, `chunkText`, constants (shared by `rag.ts` and Drive sync).
- `apps/backend/src/services/rag/index-document.ts` — **new**; `indexDocument()` + `deleteDocumentByExternalId()`.
- `apps/backend/src/services/rag/drive-extract.ts` — **new**; pure mimeType → text routing.
- `apps/backend/src/services/rag/drive-client.ts` — **new**; `DriveClient` interface + real Drive REST impl.
- `apps/backend/src/services/rag/drive-sync.ts` — **new**; source creation, backfill, incremental, sweep.
- `apps/backend/src/routes/rag-drive.ts` — **new**; source CRUD + manual trigger.
- `apps/backend/src/index.ts` — mount `rag-drive` router.
- `apps/backend/src/worker.ts` — add `runDriveSyncSweep()` to the `scheduled()` `Promise.all`.
- `apps/backend/src/services/privacy/deletion.ts` — purge Drive sources on account deletion.
- `apps/desktop/src/renderer/...` — minimal folder picker (final task).

---

## Task 1: Schema + migration for Drive sync state

**Files:**
- Modify: `packages/db/src/schema.ts` (`ragSources` ~265-283, `ragDocuments` ~285-305)
- Create: `packages/db/drizzle/<next-number>_drive_rag_sync.sql`
- Test: `apps/backend/src/services/rag/schema-cols.test.ts`

**Interfaces:**
- Produces: `ragSources.syncState` (jsonb, nullable); `ragDocuments.externalId` (text, nullable); index `rag_documents_source_external_idx` on `(source_id, external_id)`.

- [ ] **Step 1: Add columns to the Drizzle schema**

In `packages/db/src/schema.ts`, add to the `ragSources` column object (after `status`):

```ts
    syncState: jsonb("sync_state"),
```

Add to the `ragDocuments` column object (after `metadata`):

```ts
    externalId: text("external_id"),
```

Add to the `ragDocuments` index builder (the `(t) => ({ ... })` block):

```ts
    sourceExternalIdx: index("rag_documents_source_external_idx").on(t.sourceId, t.externalId),
```

- [ ] **Step 2: Write the migration SQL**

Find the highest-numbered file in `packages/db/drizzle/` and create the next one, `packages/db/drizzle/<NNNN>_drive_rag_sync.sql`:

```sql
ALTER TABLE rag_sources ADD COLUMN IF NOT EXISTS sync_state jsonb;
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS external_id text;
CREATE INDEX IF NOT EXISTS rag_documents_source_external_idx
  ON rag_documents (source_id, external_id);
```

- [ ] **Step 3: Write a guard test that the schema exposes the new fields**

Create `apps/backend/src/services/rag/schema-cols.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { ragSources, ragDocuments } from "@yomi/db"

describe("drive-sync schema columns", () => {
  it("ragSources has syncState", () => {
    expect((ragSources as Record<string, unknown>).syncState).toBeDefined()
  })
  it("ragDocuments has externalId", () => {
    expect((ragDocuments as Record<string, unknown>).externalId).toBeDefined()
  })
})
```

- [ ] **Step 4: Run the test**

Run: `cd apps/backend && bun test src/services/rag/schema-cols.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Stage + checkpoint**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/ apps/backend/src/services/rag/schema-cols.test.ts
```
Pause for commit by opencode/human. Do not run `git commit`.

---

## Task 2: Shared embeddings module + `indexDocument`

Extract the chunk/embed/store logic out of `routes/rag.ts` into reusable services so Drive sync and the manual push routes share one path.

**Files:**
- Create: `apps/backend/src/services/rag/embeddings.ts`
- Create: `apps/backend/src/services/rag/index-document.ts`
- Modify: `apps/backend/src/routes/rag.ts` (import from the new modules; refactor `upsertMirrorSource`)
- Test: `apps/backend/src/services/rag/index-document.test.ts`

**Interfaces:**
- Consumes: `db`, `ragDocuments`, `ragChunks`, `ragEmbeddings` from `@yomi/db`.
- Produces:
  - `embeddings.ts`: `embedText(input: string): Promise<number[]>`; `chunkText(content: string): string[]`; `EMBEDDING_DIMENSIONS = 1536`; `DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"`.
  - `index-document.ts`:
    - `indexDocument(input: IndexDocumentInput): Promise<{ status: "indexed" | "unchanged"; documentId: string | null }>`
    - `deleteDocumentByExternalId(userId: string, sourceId: string, externalId: string): Promise<boolean>`
    - `contentHashFor(externalId: string, text: string): string`
  - `IndexDocumentInput = { userId: string; sourceId: string; externalId: string; title: string; mimeType: string; text: string; metadata?: Record<string, unknown> }`

- [ ] **Step 1: Create the embeddings module (move existing code verbatim)**

Create `apps/backend/src/services/rag/embeddings.ts`, moving the current `embedText`, `chunkText`, and the two constants out of `routes/rag.ts`:

```ts
import { chunkMarkdown } from "@yomi/shared"

export const EMBEDDING_DIMENSIONS = 1536
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 220

export function chunkText(content: string): string[] {
  return chunkMarkdown(content, { targetChars: CHUNK_CHARS, overlap: CHUNK_OVERLAP })
}

export async function embedText(input: string): Promise<number[]> {
  if (!input.trim()) return []
  const apiKey = process.env["AI_CREDITS_API_KEY"]
  if (!apiKey) throw new Error("AI_CREDITS_API_KEY is required for Cloud RAG embeddings")
  const baseUrl = (process.env["AI_CREDITS_BASE_URL"] ?? "https://api.aicredits.in/v1").replace(
    /\/+$/,
    "",
  )
  const model = process.env["AI_CREDITS_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  })
  if (!res.ok) throw new Error(`AI Credits embeddings failed: ${res.status}`)
  const body = (await res.json()) as { data?: { embedding?: number[] }[] }
  const embedding = body.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`AI Credits embedding dimensions must be ${EMBEDDING_DIMENSIONS}`)
  }
  return embedding
}
```

- [ ] **Step 2: Point `routes/rag.ts` at the new module**

In `routes/rag.ts`: delete the local `embedText`, `chunkText`, `EMBEDDING_DIMENSIONS`, `DEFAULT_EMBEDDING_MODEL`, `CHUNK_CHARS`, `CHUNK_OVERLAP` definitions and add:

```ts
import {
  embedText,
  chunkText,
  EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from "../services/rag/embeddings.js"
```

Run `cd apps/backend && bun run typecheck` — expected: no errors (existing `rag.test.ts` still references these through the router).

- [ ] **Step 3: Write the failing test for `indexDocument`**

Create `apps/backend/src/services/rag/index-document.test.ts`:

```ts
import { describe, expect, it, mock, beforeEach } from "bun:test"

const rows: { documents: any[]; chunks: any[]; embeddings: any[] } = {
  documents: [],
  chunks: [],
  embeddings: [],
}

mock.module("@yomi/db", () => {
  const makeChain = (bucket: string) => ({
    values: (v: any) => ({
      returning: (sel?: any) => {
        const id = `${bucket}-${rows[bucket as keyof typeof rows].length}`
        rows[bucket as keyof typeof rows].push({ id, ...v })
        return Promise.resolve([{ id, ...v }])
      },
    }),
  })
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: (table: any) => makeChain(table.__name),
    delete: () => ({ where: () => Promise.resolve() }),
  }
  return {
    db,
    ragDocuments: { __name: "documents" },
    ragChunks: { __name: "chunks" },
    ragEmbeddings: { __name: "embeddings" },
  }
})

mock.module("./embeddings.js", () => ({
  embedText: async () => new Array(1536).fill(0.1),
  chunkText: (t: string) => [t],
  EMBEDDING_DIMENSIONS: 1536,
  DEFAULT_EMBEDDING_MODEL: "text-embedding-3-small",
}))

const { indexDocument, contentHashFor } = await import("./index-document.js")

beforeEach(() => {
  rows.documents = []
  rows.chunks = []
  rows.embeddings = []
})

describe("indexDocument", () => {
  it("indexes a new document with chunks and embeddings", async () => {
    const res = await indexDocument({
      userId: "u1",
      sourceId: "s1",
      externalId: "file-1",
      title: "Notes",
      mimeType: "text/plain",
      text: "hello world",
    })
    expect(res.status).toBe("indexed")
    expect(rows.documents.length).toBe(1)
    expect(rows.chunks.length).toBe(1)
    expect(rows.embeddings.length).toBe(1)
    expect(rows.documents[0].externalId).toBe("file-1")
  })

  it("contentHashFor is stable for same input and differs on change", () => {
    const a = contentHashFor("file-1", "hello")
    const b = contentHashFor("file-1", "hello")
    const c = contentHashFor("file-1", "hello!")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/backend && bun test src/services/rag/index-document.test.ts`
Expected: FAIL — cannot find module `./index-document.js`.

- [ ] **Step 5: Implement `index-document.ts`**

Create `apps/backend/src/services/rag/index-document.ts`:

```ts
import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db, ragDocuments, ragChunks, ragEmbeddings } from "@yomi/db"
import { chunkText, embedText, DEFAULT_EMBEDDING_MODEL } from "./embeddings.js"

export interface IndexDocumentInput {
  userId: string
  sourceId: string
  externalId: string
  title: string
  mimeType: string
  text: string
  metadata?: Record<string, unknown>
}

export function contentHashFor(externalId: string, text: string): string {
  return createHash("sha256").update(`${externalId}\0${text}`).digest("hex")
}

export async function indexDocument(
  input: IndexDocumentInput,
): Promise<{ status: "indexed" | "unchanged"; documentId: string | null }> {
  const contentHash = contentHashFor(input.externalId, input.text)

  const existing = await db
    .select({ id: ragDocuments.id, contentHash: ragDocuments.contentHash })
    .from(ragDocuments)
    .where(
      and(eq(ragDocuments.sourceId, input.sourceId), eq(ragDocuments.externalId, input.externalId)),
    )
    .limit(1)

  if (existing[0]?.contentHash === contentHash) {
    return { status: "unchanged", documentId: existing[0].id }
  }
  if (existing[0]) {
    // Content changed — drop the old document; chunks/embeddings cascade.
    await db.delete(ragDocuments).where(eq(ragDocuments.id, existing[0].id))
  }

  const [document] = await db
    .insert(ragDocuments)
    .values({
      userId: input.userId,
      sourceId: input.sourceId,
      title: input.title,
      mimeType: input.mimeType,
      contentHash,
      externalId: input.externalId,
      metadata: input.metadata ?? null,
    })
    .returning()

  if (!document) return { status: "indexed", documentId: null }

  const chunks = chunkText(input.text)
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const [createdChunk] = await db
      .insert(ragChunks)
      .values({
        userId: input.userId,
        documentId: document.id,
        chunkIndex,
        content: chunk,
        tokenCount: Math.ceil(chunk.length / 4),
        metadata: input.metadata ?? null,
      })
      .returning({ id: ragChunks.id })
    if (!createdChunk) continue
    const embedding = await embedText(chunk)
    await db.insert(ragEmbeddings).values({
      userId: input.userId,
      chunkId: createdChunk.id,
      model: process.env["AI_CREDITS_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL,
      embedding,
    })
  }

  return { status: "indexed", documentId: document.id }
}

export async function deleteDocumentByExternalId(
  userId: string,
  sourceId: string,
  externalId: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: ragDocuments.id })
    .from(ragDocuments)
    .where(and(eq(ragDocuments.sourceId, sourceId), eq(ragDocuments.externalId, externalId)))
    .limit(1)
  if (!existing[0]) return false
  await db.delete(ragDocuments).where(eq(ragDocuments.id, existing[0].id))
  return true
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/backend && bun test src/services/rag/index-document.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Refactor `upsertMirrorSource` to use `indexDocument`**

In `routes/rag.ts`, replace the document/chunk/embedding body of `upsertMirrorSource` (everything after the source row is upserted) with a single call:

```ts
  await indexDocument({
    userId,
    sourceId: mirroredSource.id,
    externalId: source.path,
    title,
    mimeType: "text/markdown",
    text: content,
    metadata: { path: source.path, updatedAt: source.updatedAt, origin: "cloud_archive" },
  })
  return true
```

Add the import: `import { indexDocument } from "../services/rag/index-document.js"`. Run `cd apps/backend && bun test src/routes/rag.test.ts` — expected: PASS (existing mirror tests still green).

- [ ] **Step 8: Stage + checkpoint**

```bash
git add apps/backend/src/services/rag/embeddings.ts apps/backend/src/services/rag/index-document.ts apps/backend/src/services/rag/index-document.test.ts apps/backend/src/routes/rag.ts
```
Pause for commit.

---

## Task 3: Pure Drive text extraction

**Files:**
- Create: `apps/backend/src/services/rag/drive-extract.ts`
- Test: `apps/backend/src/services/rag/drive-extract.test.ts`

**Interfaces:**
- Produces:
  - `type ExtractResult = { text: string } | { skipped: true; reason: string }`
  - `type DriveFetch = (kind: "export" | "media", mimeType?: string) => Promise<string>`
  - `driveExtract(file: { mimeType: string }, fetchFile: DriveFetch): Promise<ExtractResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/services/rag/drive-extract.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { driveExtract } from "./drive-extract.js"

describe("driveExtract", () => {
  it("exports Google Docs as text/plain", async () => {
    let calledWith: any = null
    const res = await driveExtract({ mimeType: "application/vnd.google-apps.document" }, async (k, m) => {
      calledWith = { k, m }
      return "doc body"
    })
    expect(res).toEqual({ text: "doc body" })
    expect(calledWith).toEqual({ k: "export", m: "text/plain" })
  })

  it("exports Sheets as CSV", async () => {
    const res = await driveExtract({ mimeType: "application/vnd.google-apps.spreadsheet" }, async () => "a,b")
    expect(res).toEqual({ text: "a,b" })
  })

  it("downloads plain text directly", async () => {
    const res = await driveExtract({ mimeType: "text/markdown" }, async (k) => {
      expect(k).toBe("media")
      return "# hi"
    })
    expect(res).toEqual({ text: "# hi" })
  })

  it("skips PDFs", async () => {
    const res = await driveExtract({ mimeType: "application/pdf" }, async () => "")
    expect(res).toEqual({ skipped: true, reason: "unsupported:application/pdf" })
  })

  it("skips folders", async () => {
    const res = await driveExtract({ mimeType: "application/vnd.google-apps.folder" }, async () => "")
    expect("skipped" in res).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && bun test src/services/rag/drive-extract.test.ts`
Expected: FAIL — cannot find module `./drive-extract.js`.

- [ ] **Step 3: Implement `drive-extract.ts`**

```ts
export type ExtractResult = { text: string } | { skipped: true; reason: string }
export type DriveFetch = (kind: "export" | "media", mimeType?: string) => Promise<string>

const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
}

function isDownloadable(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json"
}

export async function driveExtract(
  file: { mimeType: string },
  fetchFile: DriveFetch,
): Promise<ExtractResult> {
  const exportMime = EXPORT_MIME[file.mimeType]
  if (exportMime) {
    const text = await fetchFile("export", exportMime)
    return { text }
  }
  if (isDownloadable(file.mimeType)) {
    const text = await fetchFile("media")
    return { text }
  }
  return { skipped: true, reason: `unsupported:${file.mimeType}` }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && bun test src/services/rag/drive-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Stage + checkpoint**

```bash
git add apps/backend/src/services/rag/drive-extract.ts apps/backend/src/services/rag/drive-extract.test.ts
```
Pause for commit.

---

## Task 4: Drive REST client

**Files:**
- Create: `apps/backend/src/services/rag/drive-client.ts`
- Test: `apps/backend/src/services/rag/drive-client.test.ts`

**Interfaces:**
- Consumes: `getAccessToken(userId, provider)` from `../integration-tokens.js`.
- Produces:
  - `interface DriveFile { id: string; name: string; mimeType: string; parents?: string[]; webViewLink?: string; trashed?: boolean }`
  - `interface DriveChange { fileId: string; removed: boolean; file?: DriveFile }`
  - `interface DriveClient` with:
    - `listFolderChildren(userId: string, folderId: string, pageToken?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }>`
    - `fetchContent(userId: string, fileId: string, kind: "export" | "media", mimeType?: string): Promise<string>`
    - `getStartPageToken(userId: string): Promise<string>`
    - `listChanges(userId: string, pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken?: string; nextPageToken?: string }>`
  - `class DriveApiError extends Error { status: number }`
  - `const realDriveClient: DriveClient`

- [ ] **Step 1: Write the failing test (URL + token wiring, via injected fetch)**

Create `apps/backend/src/services/rag/drive-client.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test"

mock.module("../integration-tokens.js", () => ({
  getAccessToken: async () => "tok-123",
}))

const { makeDriveClient, DriveApiError } = await import("./drive-client.js")

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    const r = key ? routes[key] : { status: 404, body: {} }
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      text: async () => JSON.stringify(r.body),
    } as Response
  }
}

describe("driveClient", () => {
  it("lists folder children with the folder query and bearer token", async () => {
    let seenUrl = ""
    let seenAuth = ""
    const client = makeDriveClient((url: string, init?: any) => {
      seenUrl = url
      seenAuth = init?.headers?.Authorization ?? ""
      return fakeFetch({ "/files": { body: { files: [{ id: "f1", name: "n", mimeType: "text/plain" }] } } })(url)
    })
    const res = await client.listFolderChildren("u1", "folder-1")
    expect(res.files[0].id).toBe("f1")
    expect(seenUrl).toContain("folder-1")
    expect(seenAuth).toBe("Bearer tok-123")
  })

  it("throws DriveApiError with status on non-ok", async () => {
    const client = makeDriveClient(fakeFetch({ "/changes": { status: 410, body: { error: "gone" } } }) as any)
    await expect(client.listChanges("u1", "ptok")).rejects.toBeInstanceOf(DriveApiError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && bun test src/services/rag/drive-client.test.ts`
Expected: FAIL — cannot find module `./drive-client.js`.

- [ ] **Step 3: Implement `drive-client.ts`**

```ts
import { getAccessToken } from "../integration-tokens.js"

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  webViewLink?: string
  trashed?: boolean
}
export interface DriveChange {
  fileId: string
  removed: boolean
  file?: DriveFile
}
export interface DriveClient {
  listFolderChildren(
    userId: string,
    folderId: string,
    pageToken?: string,
  ): Promise<{ files: DriveFile[]; nextPageToken?: string }>
  fetchContent(
    userId: string,
    fileId: string,
    kind: "export" | "media",
    mimeType?: string,
  ): Promise<string>
  getStartPageToken(userId: string): Promise<string>
  listChanges(
    userId: string,
    pageToken: string,
  ): Promise<{ changes: DriveChange[]; newStartPageToken?: string; nextPageToken?: string }>
}

export class DriveApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = "DriveApiError"
  }
}

type FetchFn = typeof fetch

const BASE = "https://www.googleapis.com/drive/v3"
const FILE_FIELDS = "id,name,mimeType,parents,webViewLink,trashed"

export function makeDriveClient(fetchImpl: FetchFn = fetch): DriveClient {
  async function authed(userId: string, url: string): Promise<Response> {
    const token = await getAccessToken(userId, "google-drive")
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new DriveApiError(`Drive ${url} → ${res.status}: ${body.slice(0, 200)}`, res.status)
    }
    return res
  }

  return {
    async listFolderChildren(userId, folderId, pageToken) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: "100",
        fields: `nextPageToken, files(${FILE_FIELDS})`,
      })
      if (pageToken) params.set("pageToken", pageToken)
      const res = await authed(userId, `${BASE}/files?${params}`)
      const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string }
      return { files: data.files ?? [], nextPageToken: data.nextPageToken }
    },

    async fetchContent(userId, fileId, kind, mimeType) {
      const url =
        kind === "export"
          ? `${BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType ?? "text/plain")}`
          : `${BASE}/files/${encodeURIComponent(fileId)}?alt=media`
      const res = await authed(userId, url)
      return res.text()
    },

    async getStartPageToken(userId) {
      const res = await authed(userId, `${BASE}/changes/startPageToken`)
      const data = (await res.json()) as { startPageToken?: string }
      if (!data.startPageToken) throw new DriveApiError("no startPageToken", 500)
      return data.startPageToken
    },

    async listChanges(userId, pageToken) {
      const params = new URLSearchParams({
        pageToken,
        pageSize: "100",
        fields: `newStartPageToken, nextPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
      })
      const res = await authed(userId, `${BASE}/changes?${params}`)
      const data = (await res.json()) as {
        changes?: DriveChange[]
        newStartPageToken?: string
        nextPageToken?: string
      }
      return {
        changes: data.changes ?? [],
        newStartPageToken: data.newStartPageToken,
        nextPageToken: data.nextPageToken,
      }
    },
  }
}

export const realDriveClient: DriveClient = makeDriveClient()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && bun test src/services/rag/drive-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Stage + checkpoint**

```bash
git add apps/backend/src/services/rag/drive-client.ts apps/backend/src/services/rag/drive-client.test.ts
```
Pause for commit.

---

## Task 5: Sync orchestrator (create source, backfill, incremental)

**Files:**
- Create: `apps/backend/src/services/rag/drive-sync.ts`
- Test: `apps/backend/src/services/rag/drive-sync.test.ts`

**Interfaces:**
- Consumes: `DriveClient`, `DriveApiError`, `DriveFile` (Task 4); `indexDocument`, `deleteDocumentByExternalId` (Task 2); `driveExtract` (Task 3); `db`, `ragSources`, `ragDocuments` from `@yomi/db`.
- Produces:
  - `interface DriveSyncState { folderId: string; drivePageToken?: string; backfillCursor?: string | null; lastSyncedAt?: string; filesIndexed: number; filesSkipped: number }`
  - `createDriveSource(userId: string, folderId: string, name: string, client?: DriveClient): Promise<{ id: string }>`
  - `syncSource(sourceRow: SourceRow, client?: DriveClient): Promise<{ status: string; indexed: number; removed: number }>`
  - `MAX_BACKFILL_FILES_PER_TICK = 20`
  - `SourceRow = { id: string; userId: string; path: string | null; status: string; syncState: DriveSyncState | null }`

- [ ] **Step 1: Write the failing tests (backfill + incremental + auth failure)**

Create `apps/backend/src/services/rag/drive-sync.test.ts`:

```ts
import { describe, expect, it, mock, beforeEach } from "bun:test"

const state: { sources: any[]; indexed: string[]; deleted: string[] } = {
  sources: [],
  indexed: [],
  deleted: [],
}

mock.module("@yomi/db", () => {
  const db = {
    update: () => ({ set: (v: any) => ({ where: () => { Object.assign(state.sources[0], v); return Promise.resolve() } }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: (v: any) => ({ returning: () => { const row = { id: "src-1", ...v }; state.sources.push(row); return Promise.resolve([row]) } }) }),
  }
  return { db, ragSources: {}, ragDocuments: {} }
})
mock.module("./index-document.js", () => ({
  indexDocument: async (i: any) => { state.indexed.push(i.externalId); return { status: "indexed", documentId: "d" } },
  deleteDocumentByExternalId: async (_u: string, _s: string, e: string) => { state.deleted.push(e); return true },
}))

const { createDriveSource, syncSource } = await import("./drive-sync.js")

function client(overrides: any = {}) {
  return {
    getStartPageToken: async () => "ptok-0",
    listFolderChildren: async () => ({ files: [{ id: "f1", name: "A", mimeType: "text/plain" }] }),
    fetchContent: async () => "body",
    listChanges: async () => ({ changes: [], newStartPageToken: "ptok-1" }),
    ...overrides,
  }
}

beforeEach(() => { state.sources = []; state.indexed = []; state.deleted = [] })

describe("drive-sync", () => {
  it("captures a start page token when creating a source", async () => {
    await createDriveSource("u1", "folder-1", "My Folder", client() as any)
    expect(state.sources[0].syncState.drivePageToken).toBe("ptok-0")
    expect(state.sources[0].status).toBe("backfilling")
  })

  it("backfill indexes children then flips to active", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "backfilling", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const res = await syncSource(src as any, client() as any)
    expect(state.indexed).toContain("f1")
    expect(res.status).toBe("active")
  })

  it("incremental deletes trashed files in scope", async () => {
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 1, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({ listChanges: async () => ({ changes: [{ fileId: "f1", removed: true }], newStartPageToken: "ptok-2" }) })
    await syncSource(src as any, c as any)
    expect(state.deleted).toContain("f1")
  })

  it("marks needs_reconnect on 401", async () => {
    const { DriveApiError } = await import("./drive-client.js")
    const src = { id: "src-1", userId: "u1", path: "folder-1", status: "active", syncState: { folderId: "folder-1", drivePageToken: "ptok-0", filesIndexed: 0, filesSkipped: 0 } }
    state.sources.push(src)
    const c = client({ listChanges: async () => { throw new DriveApiError("unauthorized", 401) } })
    const res = await syncSource(src as any, c as any)
    expect(res.status).toBe("needs_reconnect")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && bun test src/services/rag/drive-sync.test.ts`
Expected: FAIL — cannot find module `./drive-sync.js`.

- [ ] **Step 3: Implement `drive-sync.ts`**

```ts
import { eq } from "drizzle-orm"
import { db, ragSources, ragDocuments } from "@yomi/db"
import { driveExtract } from "./drive-extract.js"
import { indexDocument, deleteDocumentByExternalId } from "./index-document.js"
import { realDriveClient, DriveApiError, type DriveClient, type DriveFile } from "./drive-client.js"

export const MAX_BACKFILL_FILES_PER_TICK = 20
export const DRIVE_SOURCE_TYPE = "google-drive"

export interface DriveSyncState {
  folderId: string
  drivePageToken?: string
  backfillCursor?: string | null
  lastSyncedAt?: string
  filesIndexed: number
  filesSkipped: number
}
export interface SourceRow {
  id: string
  userId: string
  path: string | null
  status: string
  syncState: DriveSyncState | null
}

async function setSource(id: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .update(ragSources)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ragSources.id, id))
}

async function extractAndIndex(userId: string, sourceId: string, file: DriveFile): Promise<boolean> {
  const result = await driveExtract(file, (kind, mimeType) =>
    realOrClientFetch(userId, file.id, kind, mimeType),
  )
  if ("skipped" in result) return false
  await indexDocument({
    userId,
    sourceId,
    externalId: file.id,
    title: file.name,
    mimeType: file.mimeType,
    text: result.text,
    metadata: { driveFileId: file.id, mimeType: file.mimeType, webViewLink: file.webViewLink },
  })
  return true
}

// Indirection so the client used by extractAndIndex is swappable in tests via closure.
let activeClient: DriveClient = realDriveClient
function realOrClientFetch(userId: string, fileId: string, kind: "export" | "media", mimeType?: string) {
  return activeClient.fetchContent(userId, fileId, kind, mimeType)
}

export async function createDriveSource(
  userId: string,
  folderId: string,
  name: string,
  client: DriveClient = realDriveClient,
): Promise<{ id: string }> {
  const startToken = await client.getStartPageToken(userId)
  const syncState: DriveSyncState = {
    folderId,
    drivePageToken: startToken,
    backfillCursor: null,
    filesIndexed: 0,
    filesSkipped: 0,
  }
  const [row] = await db
    .insert(ragSources)
    .values({
      userId,
      name,
      path: folderId,
      sourceType: DRIVE_SOURCE_TYPE,
      privacyScope: "cloud_rag",
      status: "backfilling",
      syncState,
    })
    .returning()
  return { id: row?.id ?? "" }
}

export async function syncSource(
  source: SourceRow,
  client: DriveClient = realDriveClient,
): Promise<{ status: string; indexed: number; removed: number }> {
  activeClient = client
  const st: DriveSyncState = source.syncState ?? {
    folderId: source.path ?? "",
    filesIndexed: 0,
    filesSkipped: 0,
  }
  try {
    if (source.status === "backfilling") return await backfillStep(source, st, client)
    return await incrementalStep(source, st, client)
  } catch (err) {
    if (err instanceof DriveApiError && (err.status === 401 || err.status === 403)) {
      await setSource(source.id, { status: "needs_reconnect" })
      return { status: "needs_reconnect", indexed: 0, removed: 0 }
    }
    if (err instanceof DriveApiError && err.status === 410) {
      // Page token expired — restart from a fresh backfill.
      const startToken = await client.getStartPageToken(source.userId)
      await setSource(source.id, {
        status: "backfilling",
        syncState: { ...st, drivePageToken: startToken, backfillCursor: null },
      })
      return { status: "backfilling", indexed: 0, removed: 0 }
    }
    throw err
  }
}

async function backfillStep(
  source: SourceRow,
  st: DriveSyncState,
  client: DriveClient,
): Promise<{ status: string; indexed: number; removed: number }> {
  const page = await client.listFolderChildren(
    source.userId,
    st.folderId,
    st.backfillCursor ?? undefined,
  )
  let indexed = 0
  for (const file of page.files.slice(0, MAX_BACKFILL_FILES_PER_TICK)) {
    const ok = await extractAndIndex(source.userId, source.id, file)
    if (ok) {
      indexed++
      st.filesIndexed++
    } else {
      st.filesSkipped++
    }
  }
  const done = !page.nextPageToken
  st.backfillCursor = page.nextPageToken ?? null
  st.lastSyncedAt = new Date().toISOString()
  await setSource(source.id, {
    status: done ? "active" : "backfilling",
    syncState: st,
  })
  return { status: done ? "active" : "backfilling", indexed, removed: 0 }
}

async function incrementalStep(
  source: SourceRow,
  st: DriveSyncState,
  client: DriveClient,
): Promise<{ status: string; indexed: number; removed: number }> {
  const knownIds = await loadKnownExternalIds(source.id)
  let token = st.drivePageToken ?? (await client.getStartPageToken(source.userId))
  let indexed = 0
  let removed = 0
  for (;;) {
    const res = await client.listChanges(source.userId, token)
    for (const change of res.changes) {
      const inScope =
        knownIds.has(change.fileId) ||
        (change.file?.parents?.includes(st.folderId) ?? false)
      if (!inScope) continue
      if (change.removed || change.file?.trashed) {
        if (await deleteDocumentByExternalId(source.userId, source.id, change.fileId)) removed++
        knownIds.delete(change.fileId)
        continue
      }
      if (change.file) {
        const ok = await extractAndIndex(source.userId, source.id, change.file)
        if (ok) {
          indexed++
          knownIds.add(change.fileId)
        }
      }
    }
    if (res.nextPageToken) {
      token = res.nextPageToken
      continue
    }
    token = res.newStartPageToken ?? token
    break
  }
  st.drivePageToken = token
  st.lastSyncedAt = new Date().toISOString()
  await setSource(source.id, { status: "active", syncState: st })
  return { status: "active", indexed, removed }
}

async function loadKnownExternalIds(sourceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: ragDocuments.externalId })
    .from(ragDocuments)
    .where(eq(ragDocuments.sourceId, sourceId))
  return new Set(rows.map((r) => r.externalId).filter((x): x is string => !!x))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && bun test src/services/rag/drive-sync.test.ts`
Expected: PASS (4 tests). If `loadKnownExternalIds` select chain differs from the mock, extend the test's `db.select` mock to return `[]` for the incremental case (already covered by the default select mock returning `[]`).

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Stage + checkpoint**

```bash
git add apps/backend/src/services/rag/drive-sync.ts apps/backend/src/services/rag/drive-sync.test.ts
```
Pause for commit.

---

## Task 6: HTTP routes for Drive sources

**Files:**
- Create: `apps/backend/src/routes/rag-drive.ts`
- Modify: `apps/backend/src/index.ts` (mount router)
- Test: `apps/backend/src/routes/rag-drive.test.ts`

**Interfaces:**
- Consumes: `createDriveSource`, `syncSource`, `DRIVE_SOURCE_TYPE`, `SourceRow` (Task 5); `authenticate` (`../auth.js`), `requireConsent` (`../middleware/consent.js`), `ragAllowed`/`effectivePlanForUser`/`isOwnerUser` patterns from `routes/rag.ts`.
- Produces: `ragDriveRouter` exported; mounted at `/api/rag/drive`.
  - `POST /sources { folderId, name }` → `{ id }`
  - `GET /sources` → `{ sources: [...] }` (google-drive only, with status + counts from syncState)
  - `DELETE /sources/:id` → `{ ok }`
  - `POST /sources/:id/sync` → `{ status, indexed, removed }`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/routes/rag-drive.test.ts` (mirror the auth/mock setup in `rag.test.ts`; mock `../services/rag/drive-sync.js` so `createDriveSource` returns `{ id: "src-1" }` and `syncSource` returns `{ status: "active", indexed: 2, removed: 0 }`). Assert:

```ts
// POST /sources with a folderId returns the created id
// POST /sources without folderId returns 400
// POST /sources/:id/sync returns the syncSource result
```

Use the same `mock.module("../auth.js", ...)`, `requireConsent`, and plan-gate mocks that `rag.test.ts` already uses (copy that header block verbatim so the Pro gate passes for the test user).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && bun test src/routes/rag-drive.test.ts`
Expected: FAIL — cannot find module `./rag-drive.js`.

- [ ] **Step 3: Implement `rag-drive.ts`**

```ts
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"
import { authenticate } from "../auth.js"
import { requireConsent } from "../middleware/consent.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"
import {
  createDriveSource,
  syncSource,
  DRIVE_SOURCE_TYPE,
  type SourceRow,
} from "../services/rag/drive-sync.js"

export const ragDriveRouter = new Hono()

function ragAllowed(user: { id: string; email?: string | null; plan?: string | null }): boolean {
  if (isOwnerUser(user)) return true
  const plan = effectivePlanForUser(user)
  return plan === "pro" || plan === "max"
}

ragDriveRouter.use("*", authenticate)

ragDriveRouter.post("/sources", requireConsent("cloud_memory"), async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)
  const body = (await c.req.json().catch(() => ({}))) as { folderId?: string; name?: string }
  const folderId = (body.folderId ?? "").trim()
  const name = (body.name ?? "Drive folder").trim().slice(0, 120)
  if (!folderId) return c.json({ error: "folderId is required", code: "invalid_folder" }, 400)
  const created = await createDriveSource(user.id, folderId, name)
  return c.json(created)
})

ragDriveRouter.get("/sources", requireConsent("cloud_memory"), async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)
  const rows = await db
    .select()
    .from(ragSources)
    .where(and(eq(ragSources.userId, user.id), eq(ragSources.sourceType, DRIVE_SOURCE_TYPE)))
  const sources = rows
    .filter((r) => r.status !== "deleted")
    .map((r) => ({
      id: r.id,
      name: r.name,
      folderId: r.path,
      status: r.status,
      syncState: r.syncState,
    }))
  return c.json({ sources })
})

ragDriveRouter.delete("/sources/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
  return c.json({ ok: true })
})

ragDriveRouter.post("/sources/:id/sync", requireConsent("cloud_memory"), async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)
  const id = c.req.param("id")
  const [row] = await db
    .select()
    .from(ragSources)
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
    .limit(1)
  if (!row) return c.json({ error: "not found", code: "not_found" }, 404)
  const result = await syncSource(row as unknown as SourceRow)
  return c.json(result)
})
```

- [ ] **Step 4: Mount the router in `index.ts`**

Add near the other route imports/mounts in `apps/backend/src/index.ts`:

```ts
import { ragDriveRouter } from "./routes/rag-drive.js"
// ...alongside app.route("/api/rag", ragRouter):
app.route("/api/rag/drive", ragDriveRouter)
```

Confirm the existing `ragRouter` is mounted at `/api/rag`; if it is mounted differently, mirror that prefix so drive routes sit under it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && bun test src/routes/rag-drive.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + stage**

Run: `cd apps/backend && bun run typecheck` (expected: no errors), then:

```bash
git add apps/backend/src/routes/rag-drive.ts apps/backend/src/routes/rag-drive.test.ts apps/backend/src/index.ts
```
Pause for commit.

---

## Task 7: Scheduled sweep in the Worker

**Files:**
- Modify: `apps/backend/src/services/rag/drive-sync.ts` (add `runDriveSyncSweep`)
- Modify: `apps/backend/src/worker.ts` (add to `scheduled()` `Promise.all`)
- Test: `apps/backend/src/services/rag/drive-sweep.test.ts`

**Interfaces:**
- Produces: `runDriveSyncSweep(): Promise<{ ran: number }>` — selects google-drive sources in status `backfilling` or `active` that are due (never synced, or `lastSyncedAt` older than `DRIVE_SYNC_INTERVAL_MS`), runs `syncSource` for up to `MAX_SOURCES_PER_SWEEP`, returns how many it ran.
- Constants: `DRIVE_SYNC_INTERVAL_MS` (default 6h via `process.env.DRIVE_SYNC_INTERVAL_MS`), `MAX_SOURCES_PER_SWEEP = 10`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/services/rag/drive-sweep.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test"

const dueRows = [
  { id: "src-1", userId: "u1", path: "f1", status: "active", syncState: { folderId: "f1", filesIndexed: 0, filesSkipped: 0 } },
]
mock.module("@yomi/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => dueRows }) }) }) },
  ragSources: { sourceType: {}, status: {} },
  ragDocuments: {},
}))
let synced = 0
mock.module("./index-document.js", () => ({ indexDocument: async () => ({ status: "indexed" }), deleteDocumentByExternalId: async () => false }))

const mod = await import("./drive-sync.js")
// Replace syncSource on the module boundary via a spy on the exported client path:
;(mod as any).syncSource = async () => { synced++; return { status: "active", indexed: 0, removed: 0 } }

describe("runDriveSyncSweep", () => {
  it("runs due sources", async () => {
    const res = await mod.runDriveSyncSweep()
    expect(res.ran).toBeGreaterThanOrEqual(1)
  })
})
```

> Note: if reassigning the export is not reliable under `bun:test`, instead structure `runDriveSyncSweep` to accept an optional injected `run = syncSource` parameter (`runDriveSyncSweep(run = syncSource)`) and pass a fake in the test. Prefer the injectable-parameter form.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && bun test src/services/rag/drive-sweep.test.ts`
Expected: FAIL — `runDriveSyncSweep` is not a function.

- [ ] **Step 3: Implement `runDriveSyncSweep` (injectable runner)**

Append to `drive-sync.ts`:

```ts
import { and, inArray, isNull, lt, or } from "drizzle-orm"

export const MAX_SOURCES_PER_SWEEP = 10
const DRIVE_SYNC_INTERVAL_MS = Number(process.env["DRIVE_SYNC_INTERVAL_MS"] ?? 6 * 60 * 60 * 1000)

export async function runDriveSyncSweep(
  run: (s: SourceRow, c?: DriveClient) => Promise<unknown> = syncSource,
): Promise<{ ran: number }> {
  const cutoff = new Date(Date.now() - DRIVE_SYNC_INTERVAL_MS)
  const rows = await db
    .select()
    .from(ragSources)
    .where(
      and(
        eq(ragSources.sourceType, DRIVE_SOURCE_TYPE),
        inArray(ragSources.status, ["backfilling", "active"]),
        or(isNull(ragSources.updatedAt), lt(ragSources.updatedAt, cutoff)),
      ),
    )
    .limit(MAX_SOURCES_PER_SWEEP)
  let ran = 0
  for (const row of rows) {
    try {
      await run(row as unknown as SourceRow)
      ran++
    } catch (err) {
      console.error(`[drive-sync] source ${row.id} failed:`, err)
    }
  }
  return { ran }
}
```

> `backfilling` sources should sweep more often than 6h so the backfill completes promptly. If the 6h cutoff makes backfill too slow in practice, drop the `updatedAt` cutoff for `backfilling` rows (tunable during review).

- [ ] **Step 4: Hook into `worker.ts`**

In `apps/backend/src/worker.ts`, import and add a third entry to the `scheduled()` `Promise.all`:

```ts
import { runDriveSyncSweep } from "./services/rag/drive-sync.js"
// inside Promise.all([...]) add:
        runDriveSyncSweep()
          .then(({ ran }) => {
            if (ran > 0) console.warn(`[drive-sync] swept ${ran} source(s)`)
          })
          .catch((err) => console.error("[drive-sync] sweep error:", err)),
```

- [ ] **Step 5: Run the test + typecheck**

Run: `cd apps/backend && bun test src/services/rag/drive-sweep.test.ts` (expected: PASS), then `bun run typecheck` (expected: no errors).

- [ ] **Step 6: Stage + checkpoint**

```bash
git add apps/backend/src/services/rag/drive-sync.ts apps/backend/src/services/rag/drive-sweep.test.ts apps/backend/src/worker.ts
```
Pause for commit.

---

## Task 8: Privacy purge on account deletion

**Files:**
- Modify: `apps/backend/src/services/privacy/deletion.ts`
- Test: extend the nearest existing deletion test, or add `apps/backend/src/services/privacy/deletion-drive.test.ts`

**Interfaces:**
- Consumes: `db`, `ragSources` from `@yomi/db`; existing deletion routine.
- Produces: deletion routine also removes `google-drive` `rag_sources` for the user (documents/chunks/embeddings cascade via existing FK `onDelete: "cascade"`).

- [ ] **Step 1: Inspect the existing deletion routine**

Open `apps/backend/src/services/privacy/deletion.ts` and find where user-scoped rows are purged (it already references rag/memory per earlier grep). Confirm whether `rag_sources` is deleted by `userId`. If it already deletes all `rag_sources` for the user, Drive sources are covered — add only a regression test (Step 2) and skip Step 3.

- [ ] **Step 2: Write a regression test**

Add a test asserting that after the deletion routine runs for a user, a query for that user's `google-drive` `rag_sources` returns none. Mock `db` to record `delete(...).where(...)` calls and assert a delete targeting `ragSources` scoped to the user id was issued.

- [ ] **Step 3: Add the purge if missing**

If `rag_sources` is not already purged by userId, add (near the other rag purges):

```ts
await db.delete(ragSources).where(eq(ragSources.userId, userId))
```

Ensure `ragSources` is imported from `@yomi/db`.

- [ ] **Step 4: Run the test + typecheck**

Run: `cd apps/backend && bun test src/services/privacy/` (expected: PASS), then `bun run typecheck`.

- [ ] **Step 5: Stage + checkpoint**

```bash
git add apps/backend/src/services/privacy/deletion.ts apps/backend/src/services/privacy/
```
Pause for commit.

---

## Task 9: Minimal desktop folder picker

Keep this thin: the backend is the product; this is just enough UI to create a source.

**Files:**
- Modify: the Integrations UI in `apps/desktop/src/renderer/` (find the connectors/integrations panel that lists Google Drive) and `apps/landing` dashboard if that is where integration management lives — pick whichever already renders connector cards.
- Test: component test if the surrounding UI has them; otherwise manual verification steps below.

**Interfaces:**
- Consumes: `GET /api/rag/drive/sources`, `POST /api/rag/drive/sources`, `DELETE /api/rag/drive/sources/:id`.

- [ ] **Step 1: Locate the integrations UI**

Run: `cd apps/desktop && grep -rn "Google Drive\|google-drive" src/renderer | head` to find the connector card. Add a "Indexed folders" section under the Drive card shown only when Drive is connected.

- [ ] **Step 2: Add a folder-add control**

Minimal v1: a text input for a Drive folder ID + "Index this folder" button that calls `POST /api/rag/drive/sources { folderId, name }`, and a list of existing sources from `GET /api/rag/drive/sources` showing `name`, `status`, and `syncState.filesIndexed`, each with a "Remove" button calling `DELETE`. A folder *browser* (picker tree) is a later enhancement — do not build it now (YAGNI).

- [ ] **Step 3: Manual verification**

With the app running and Drive connected:
1. Add a folder → a source appears with status `backfilling`.
2. Within a couple of minutes (sweep interval), status flips to `active` and `filesIndexed` > 0.
3. Ask the agent something answerable only from a doc in that folder → it cites the Drive file.
4. Remove the folder → source disappears; the doc is no longer cited.

- [ ] **Step 4: Stage + checkpoint**

```bash
git add apps/desktop/src/renderer/
```
Pause for commit.

---

## Self-Review

**Spec coverage:**
- Backend-owned pipeline → Tasks 4–7. ✅
- User-picked folders → Task 6 `POST /sources`, Task 9 UI. ✅
- Scheduled incremental via Changes API → Task 5 `incrementalStep`, Task 7 sweep. ✅
- File types (Google-native + text; skip others) → Task 3. ✅
- Direct children only → Task 5 scope filter (`parents.includes(folderId)`). ✅
- Capture startPageToken before backfill → Task 5 `createDriveSource`. ✅
- Batched backfill → Task 5 `backfillStep` + `MAX_BACKFILL_FILES_PER_TICK`. ✅
- Data model (sync_state, external_id) → Task 1. ✅
- Auth failure → needs_reconnect; 410 → re-backfill → Task 5 `syncSource` catch. ✅
- Dedup by content hash → Task 2 `contentHashFor` + `indexDocument`. ✅
- Consent + Pro gate → Task 6 routes. ✅
- Privacy purge → Task 8. ✅
- No credit charge → nothing charges credits in any task (guardrail is folder scope + `MAX_BACKFILL_FILES_PER_TICK`). ✅

**Type consistency:** `SourceRow`, `DriveSyncState`, `DriveClient`, `DriveFile`, `IndexDocumentInput`, `ExtractResult`, `runDriveSyncSweep` signatures match across Tasks 2–7. `DRIVE_SOURCE_TYPE` used consistently in Tasks 5, 6, 7.

**Deferred (v2, explicitly out of scope):** recursive subfolders, PDF/Office extraction, real-time webhooks, folder-browser UI.
