import { appendFile, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { initMemoryDir, notepadDir } from "./loader.js"

export type SessionTurnKind = "fast" | "agent"

export type SessionTurn = {
  kind: SessionTurnKind
  input: string
  output: string
  mode?: string
  summary?: string
}

const MAX_FIELD_CHARS = 1200
const MAX_RECENT_CHARS = 3000

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowISO(): string {
  return new Date().toISOString()
}

function sessionPath(date = todayISO()): string {
  return join(notepadDir(), "sessions", `${date}-dev.md`)
}

function clean(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_FIELD_CHARS)
    .trim()
}

export async function appendSessionTurn(turn: SessionTurn): Promise<void> {
  await initMemoryDir()

  const parts = [
    `## ${nowISO()} - ${turn.kind}${turn.mode ? `/${turn.mode}` : ""}`,
    "",
    `User: ${clean(turn.input) || "(empty)"}`,
    "",
    `Assistant: ${clean(turn.output || turn.summary || "") || "(empty)"}`,
    "",
  ]

  await appendFile(sessionPath(), `${parts.join("\n")}\n`, "utf-8")
}

export async function loadRecentSession(maxChars = MAX_RECENT_CHARS): Promise<string> {
  const log = await readFile(sessionPath(), "utf-8").catch(() => "")
  if (!log.trim()) return ""
  return log.slice(-maxChars).trim()
}

export async function remember(key: string, content: string): Promise<void> {
  await initMemoryDir()

  const safeKey = clean(key).replace(/\n/g, " ").slice(0, 80) || "memory"
  const safeContent = clean(content)
  if (!safeContent) return

  const memPath = join(notepadDir(), "memory.md")
  const current = await readFile(memPath, "utf-8").catch(() => "")
  const entry = `- ${safeKey}: ${safeContent}`
  if (current.includes(entry)) return

  const next = current.trim()
    ? `${current.trim()}\n${entry}\n`
    : `# Long-term memory - [last updated: ${todayISO()}]\n\n${entry}\n`

  await writeFile(memPath, next, "utf-8")
}

export async function forget(query: string): Promise<number> {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  const memPath = join(notepadDir(), "memory.md")
  const current = await readFile(memPath, "utf-8").catch(() => "")
  const lines = current.split("\n")
  const kept = lines.filter(line => !line.toLowerCase().includes(needle))
  const removed = lines.length - kept.length
  if (removed > 0) await writeFile(memPath, kept.join("\n"), "utf-8")
  return removed
}
