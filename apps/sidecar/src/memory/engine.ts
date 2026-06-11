import { Database } from "bun:sqlite"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { generateText } from "ai"
import { createModel } from "../pipeline/model.js"
import { initMemoryDir, notepadDir } from "./loader.js"

export type MemoryStatus = "active" | "superseded" | "uncertain" | "forgotten"
export type MemoryKind =
  | "preference"
  | "fact"
  | "project"
  | "decision"
  | "open_thread"
  | "correction"

export type MemoryRecord = {
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

export type RetrievedMemory = Pick<
  MemoryRecord,
  "id" | "kind" | "topic" | "content" | "confidence" | "sourcePath"
>

type ExtractedMemory = {
  kind: MemoryKind
  scope?: string
  topic: string
  content: string
  confidence?: number
  replaces_topic?: string
}

const EXTRACTION_MODEL =
  process.env.MEMORY_EXTRACTION_MODEL || process.env.AI_CREDITS_FAST_MODEL || "gpt-4.1-mini"
const MAX_PROFILE_CHARS = 3000

let db: Database | null = null
let openedPath: string | null = null

function dbPath(): string {
  return join(notepadDir(), "memory.db")
}

function nowISO(): string {
  return new Date().toISOString()
}

function memoryDir(): string {
  return join(notepadDir(), "memory")
}

function profilePath(kind: "static" | "dynamic"): string {
  return join(memoryDir(), `profile.${kind}.md`)
}

function cleanText(value: string, max = 1800): string {
  return value
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

function openDb(): Database {
  const path = dbPath()
  if (db && openedPath === path) return db
  db?.close()
  db = new Database(path, { create: true })
  openedPath = path
  db.exec(`
    create table if not exists memories (
      id text primary key,
      kind text not null,
      scope text not null default 'global',
      topic text not null,
      content text not null,
      status text not null default 'active',
      confidence real not null default 0.7,
      source_path text,
      source_turn_id text,
      superseded_by text,
      created_at text not null,
      updated_at text not null
    );
    create virtual table if not exists memory_fts using fts5(
      id unindexed,
      topic,
      content,
      scope,
      tokenize = 'porter'
    );
    create table if not exists profiles (
      key text primary key,
      content text not null,
      updated_at text not null
    );
    create index if not exists memories_status_idx on memories(status);
    create index if not exists memories_topic_idx on memories(topic);
  `)
  return db
}

export async function initMemoryEngine(): Promise<void> {
  await initMemoryDir()
  await mkdir(memoryDir(), { recursive: true })
  openDb()
}

export function closeMemoryEngine(): void {
  db?.close()
  db = null
  openedPath = null
}

export async function readProfile(kind: "static" | "dynamic"): Promise<string> {
  await initMemoryEngine()
  const file = await readFile(profilePath(kind), "utf-8").catch(() => "")
  if (file.trim()) return file.slice(0, MAX_PROFILE_CHARS)
  const row = openDb()
    .query<{ content: string }, [string]>("select content from profiles where key = ?")
    .get(kind)
  return (row?.content ?? "").slice(0, MAX_PROFILE_CHARS)
}

export function retrieveLocalMemoryContext(query: string, maxChars = 3000): string {
  const q = cleanText(query, 400)
  if (!q) return ""
  const database = openDb()
  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 8)
    .map((term) => `"${term.replace(/"/g, "")}"*`)
    .join(" OR ")
  if (!terms) return ""

  const rows = database
    .query<RetrievedMemory, [string]>(
      `
    select m.id, m.kind, m.topic, m.content, m.confidence, m.source_path as sourcePath
    from memory_fts f
    join memories m on m.id = f.id
    where memory_fts match ?
      and m.status = 'active'
      and m.confidence >= 0.45
    order by bm25(memory_fts), m.updated_at desc
    limit 8
  `,
    )
    .all(terms)

  const out: string[] = []
  let used = 0
  for (const row of rows) {
    const snippet = `- [${row.kind}] ${row.topic}: ${row.content}${row.sourcePath ? ` (source: ${row.sourcePath})` : ""}`
    if (used + snippet.length > maxChars) break
    out.push(snippet)
    used += snippet.length
  }
  return out.join("\n")
}

function insertMemory(memory: ExtractedMemory, sourcePath: string, sourceTurnId: string): void {
  const database = openDb()
  const id = crypto.randomUUID()
  const now = nowISO()
  const confidence = Math.max(0, Math.min(1, memory.confidence ?? 0.7))
  const scope = cleanText(memory.scope ?? "global", 80) || "global"
  const topic = cleanText(memory.topic, 120)
  const content = cleanText(memory.content, 1200)
  if (!topic || !content || confidence < 0.45) return

  if (memory.replaces_topic) {
    const replaceTopic = cleanText(memory.replaces_topic, 120)
    database.run(
      "update memories set status = 'superseded', superseded_by = ?, updated_at = ? where status = 'active' and lower(topic) = lower(?)",
      [id, now, replaceTopic],
    )
  }

  database.run(
    `insert into memories (id, kind, scope, topic, content, status, confidence, source_path, source_turn_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [id, memory.kind, scope, topic, content, confidence, sourcePath, sourceTurnId, now, now],
  )
  database.run("insert into memory_fts (id, topic, content, scope) values (?, ?, ?, ?)", [
    id,
    topic,
    content,
    scope,
  ])
}

function parseMemories(text: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(text) as { memories?: ExtractedMemory[] }
    return Array.isArray(parsed.memories) ? parsed.memories : []
  } catch {
    return []
  }
}

export async function captureTurnMemory(turn: {
  input: string
  output: string
  mode?: string
  sourcePath?: string
}): Promise<void> {
  await initMemoryEngine()
  const input = cleanText(turn.input)
  const output = cleanText(turn.output)
  if (!input || !output) return

  const { text } = await generateText({
    model: createModel(EXTRACTION_MODEL),
    messages: [
      {
        role: "user",
        content: `Extract durable user memory from this Yomi interaction.

Return strict JSON only:
{"memories":[{"kind":"preference|fact|project|decision|open_thread|correction","scope":"global|project|app|session","topic":"short key","content":"one concise memory","confidence":0.0,"replaces_topic":"optional old topic"}]}

Rules:
- Store only useful future context.
- Do not store screenshots, audio, base64, secrets, passwords, or one-off trivia.
- Prefer high precision. If uncertain, omit it.
- Use replaces_topic only for clear corrections or updates.

User: ${input}
Assistant: ${output}`,
      },
    ],
  })

  const sourceTurnId = crypto.randomUUID()
  for (const memory of parseMemories(text)) {
    insertMemory(memory, turn.sourcePath ?? "", sourceTurnId)
  }
  await updateUserProfiles()
}

export async function updateUserProfiles(): Promise<void> {
  await initMemoryEngine()
  const database = openDb()
  const rows = database
    .query<Pick<MemoryRecord, "kind" | "topic" | "content" | "confidence">, []>(
      `
    select kind, topic, content, confidence
    from memories
    where status = 'active'
    order by confidence desc, updated_at desc
    limit 80
  `,
    )
    .all()

  const stable = rows
    .filter((m) => m.kind === "preference" || m.kind === "fact")
    .map((m) => `- ${m.topic}: ${m.content}`)
    .join("\n")
  const dynamic = rows
    .filter(
      (m) =>
        m.kind === "project" ||
        m.kind === "decision" ||
        m.kind === "open_thread" ||
        m.kind === "correction",
    )
    .map((m) => `- ${m.topic}: ${m.content}`)
    .join("\n")
  const now = nowISO()

  await writeFile(profilePath("static"), stable ? `# Static profile\n\n${stable}\n` : "", "utf-8")
  await writeFile(
    profilePath("dynamic"),
    dynamic ? `# Dynamic profile\n\n${dynamic}\n` : "",
    "utf-8",
  )
  database.run(
    "insert into profiles (key, content, updated_at) values (?, ?, ?) on conflict(key) do update set content = excluded.content, updated_at = excluded.updated_at",
    ["static", stable, now],
  )
  database.run(
    "insert into profiles (key, content, updated_at) values (?, ?, ?) on conflict(key) do update set content = excluded.content, updated_at = excluded.updated_at",
    ["dynamic", dynamic, now],
  )
}

export async function forgetLocalMemory(queryOrId: string): Promise<number> {
  await initMemoryEngine()
  const value = cleanText(queryOrId, 200).toLowerCase()
  if (!value) return 0
  const result = openDb().run(
    "update memories set status = 'forgotten', updated_at = ? where lower(id) = ? or lower(topic) like ? or lower(content) like ?",
    [nowISO(), value, `%${value}%`, `%${value}%`],
  )
  await updateUserProfiles()
  return result.changes
}

export async function reindexLocalMemory(): Promise<void> {
  await initMemoryEngine()
  const database = openDb()
  database.run("delete from memory_fts")
  const rows = database
    .query<
      Pick<MemoryRecord, "id" | "topic" | "content" | "scope">,
      []
    >("select id, topic, content, scope from memories where status = 'active'")
    .all()
  for (const row of rows) {
    database.run("insert into memory_fts (id, topic, content, scope) values (?, ?, ?, ?)", [
      row.id,
      row.topic,
      row.content,
      row.scope,
    ])
  }
}
