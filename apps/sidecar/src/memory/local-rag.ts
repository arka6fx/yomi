import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { chunkMarkdown } from "@yomi/shared"
import { initMemoryDir, notepadDir } from "./loader.js"

export type ArchiveSource = {
  path: string
  title: string
  content: string
  hash: string
  updatedAt: string
}

type LocalRagRow = {
  sourcePath: string
  title: string
  content: string
}

const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 220
const MAX_SOURCE_CHARS = 120_000

let db: Database | null = null
let openedPath: string | null = null

function dbPath(): string {
  return join(notepadDir(), "memory.db")
}

function openDb(): Database {
  const path = dbPath()
  if (db && openedPath === path) return db
  db?.close()
  db = new Database(path, { create: true })
  openedPath = path
  db.exec(`
    create table if not exists local_rag_sources (
      path text primary key,
      title text not null,
      content_hash text not null,
      updated_at text not null,
      indexed_at text not null
    );
    create table if not exists local_rag_chunks (
      id text primary key,
      source_path text not null,
      chunk_index integer not null,
      title text not null,
      content text not null,
      updated_at text not null
    );
    create virtual table if not exists local_rag_fts using fts5(
      id unindexed,
      source_path unindexed,
      title,
      content,
      tokenize = 'porter'
    );
    create index if not exists local_rag_chunks_source_idx on local_rag_chunks(source_path);
  `)
  return db
}

export async function initLocalRag(): Promise<void> {
  await initMemoryDir()
  openDb()
}

export function closeLocalRag(): void {
  db?.close()
  db = null
  openedPath = null
}

function cleanText(value: string, max = MAX_SOURCE_CHARS): string {
  return value
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function chunkText(content: string): string[] {
  return chunkMarkdown(content, { targetChars: CHUNK_CHARS, overlap: CHUNK_OVERLAP })
}

async function readMarkdownSource(absPath: string, root: string): Promise<ArchiveSource | null> {
  const info = await stat(absPath).catch(() => null)
  if (!info?.isFile()) return null
  const raw = await readFile(absPath)
  if (raw.includes(0)) return null
  const content = cleanText(raw.toString("utf-8"))
  if (!content) return null
  const sourcePath = relative(root, absPath).replace(/\\/g, "/")
  return {
    path: sourcePath,
    title: basename(absPath),
    content,
    hash: hash(content),
    updatedAt: new Date(info.mtimeMs).toISOString(),
  }
}

async function collectProjectFiles(dir: string, root: string, out: ArchiveSource[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const absPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectProjectFiles(absPath, root, out)
      continue
    }
    if (entry.name !== "context.md" && entry.name !== "scratchpad.md") continue
    const source = await readMarkdownSource(absPath, root)
    if (source) out.push(source)
  }
}

async function collectMemoryFiles(dir: string, root: string, out: ArchiveSource[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const absPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectMemoryFiles(absPath, root, out)
      continue
    }
    if (!entry.name.endsWith(".md")) continue
    if (entry.name === "profile.static.md" || entry.name === "profile.dynamic.md") continue
    const source = await readMarkdownSource(absPath, root)
    if (source) out.push(source)
  }
}

export async function scanArchiveSources(): Promise<ArchiveSource[]> {
  const root = notepadDir()
  const out: ArchiveSource[] = []

  const sessionsDir = join(root, "sessions")
  const sessions = await readdir(sessionsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of sessions) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const source = await readMarkdownSource(join(sessionsDir, entry.name), root)
    if (source) out.push(source)
  }

  await collectProjectFiles(join(root, "projects"), root, out)
  await collectMemoryFiles(join(root, "memory"), root, out)

  return out
}

function upsertSource(source: ArchiveSource): void {
  const database = openDb()
  const existing = database
    .query<{ contentHash: string }, [string]>("select content_hash as contentHash from local_rag_sources where path = ?")
    .get(source.path)
  if (existing?.contentHash === source.hash) return

  database.run("delete from local_rag_fts where source_path = ?", [source.path])
  database.run("delete from local_rag_chunks where source_path = ?", [source.path])
  database.run(
    `insert into local_rag_sources (path, title, content_hash, updated_at, indexed_at)
     values (?, ?, ?, ?, ?)
     on conflict(path) do update set
       title = excluded.title,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at,
       indexed_at = excluded.indexed_at`,
    [source.path, source.title, source.hash, source.updatedAt, new Date().toISOString()],
  )

  for (const [index, chunk] of chunkText(source.content).entries()) {
    const id = `${source.path}#${index}`
    database.run(
      "insert into local_rag_chunks (id, source_path, chunk_index, title, content, updated_at) values (?, ?, ?, ?, ?, ?)",
      [id, source.path, index, source.title, chunk, source.updatedAt],
    )
    database.run(
      "insert into local_rag_fts (id, source_path, title, content) values (?, ?, ?, ?)",
      [id, source.path, source.title, chunk],
    )
  }
}

export async function indexLocalRagSources(): Promise<void> {
  await initLocalRag()
  const database = openDb()
  const sources = await scanArchiveSources()
  const currentPaths = new Set(sources.map((source) => source.path))

  for (const source of sources) upsertSource(source)

  const indexed = database.query<{ path: string }, []>("select path from local_rag_sources").all()
  for (const row of indexed) {
    if (currentPaths.has(row.path)) continue
    database.run("delete from local_rag_fts where source_path = ?", [row.path])
    database.run("delete from local_rag_chunks where source_path = ?", [row.path])
    database.run("delete from local_rag_sources where path = ?", [row.path])
  }
}

function queryTerms(query: string): string {
  return cleanText(query, 400)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 8)
    .map((term) => `"${term.replace(/"/g, "")}"*`)
    .join(" OR ")
}

export async function retrieveLocalRagContext(query: string, maxChars = 3000): Promise<string> {
  const terms = queryTerms(query)
  if (!terms) return ""

  try {
    await indexLocalRagSources()
    const rows = openDb().query<LocalRagRow, [string]>(`
      select c.source_path as sourcePath, c.title as title, c.content as content
      from local_rag_fts f
      join local_rag_chunks c on c.id = f.id
      where local_rag_fts match ?
      order by bm25(local_rag_fts), c.updated_at desc
      limit 8
    `).all(terms)

    // Numbered, attributed blocks so the model can cite sources inline as [n].
    const out: string[] = []
    let used = 0
    for (const row of rows) {
      const block = `[${out.length + 1}] ${row.sourcePath}\n${row.content}`
      if (used + block.length > maxChars) break
      out.push(block)
      used += block.length
    }
    return out.join("\n\n")
  } catch (err) {
    console.warn("[yomi/local-rag] retrieval failed:", err instanceof Error ? err.message : err)
    return ""
  }
}
