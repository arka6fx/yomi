import { appendFile, readFile, mkdir, readdir, unlink } from "node:fs/promises"
import { join, dirname } from "node:path"
import { initMemoryDir, notepadDir } from "./loader.js"

export interface ChatTurn {
  id: number
  transcript: string
  text: string
  timestamp: string
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function getYesterdayStr(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().slice(0, 10)
}

export function getHistoryPath(date: string): string {
  return join(notepadDir(), "sessions", `chat-history-${date}.jsonl`)
}

export async function appendTurn(turn: ChatTurn): Promise<void> {
  await initMemoryDir()
  const path = getHistoryPath(getTodayStr())
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  const line = JSON.stringify(turn) + "\n"
  await appendFile(path, line, "utf-8")
}

export async function loadRecentTurns(limit = 20): Promise<ChatTurn[]> {
  await initMemoryDir()
  const todayPath = getHistoryPath(getTodayStr())
  const yesterdayPath = getHistoryPath(getYesterdayStr())

  const readLines = async (path: string): Promise<ChatTurn[]> => {
    try {
      const data = await readFile(path, "utf-8")
      return data
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as ChatTurn)
    } catch {
      return []
    }
  }

  const yesterdayTurns = await readLines(yesterdayPath)
  const todayTurns = await readLines(todayPath)

  const all = [...yesterdayTurns, ...todayTurns]
  return all.slice(-limit)
}

export async function listHistoryTurns(limit = 100, query?: string): Promise<ChatTurn[]> {
  await initMemoryDir()
  const dir = join(notepadDir(), "sessions")
  let files: string[] = []
  try {
    files = (await readdir(dir))
      .filter((file) => /^chat-history-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort()
  } catch {
    return []
  }

  const needle = query?.trim().toLowerCase()
  const turns: ChatTurn[] = []
  for (const file of files.slice(-30)) {
    try {
      const data = await readFile(join(dir, file), "utf-8")
      for (const line of data.split("\n")) {
        if (!line.trim()) continue
        const turn = JSON.parse(line) as ChatTurn
        if (
          needle &&
          !turn.transcript.toLowerCase().includes(needle) &&
          !turn.text.toLowerCase().includes(needle)
        )
          continue
        turns.push(turn)
      }
    } catch {
      // Skip corrupt history files; one bad line should not break the UI.
    }
  }
  return turns
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-limit)
    .reverse()
}

export async function deleteHistoryTurn(id: number): Promise<boolean> {
  await initMemoryDir()
  const dir = join(notepadDir(), "sessions")
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((file) =>
      /^chat-history-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file),
    )
  } catch {
    return false
  }

  let deleted = false
  for (const file of files) {
    const path = join(dir, file)
    let turns: ChatTurn[] = []
    try {
      const data = await readFile(path, "utf-8")
      turns = data
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ChatTurn)
    } catch {
      continue
    }
    const next = turns.filter((turn) => turn.id !== id)
    if (next.length === turns.length) continue
    deleted = true
    if (next.length === 0) await unlink(path).catch(() => {})
    else await appendRewrite(path, next)
  }
  return deleted
}

async function appendRewrite(path: string, turns: ChatTurn[]): Promise<void> {
  const tmp = `${path}.tmp.${Date.now()}`
  const { writeFile, rename } = await import("node:fs/promises")
  await writeFile(tmp, turns.map((turn) => JSON.stringify(turn)).join("\n") + "\n", "utf-8")
  await rename(tmp, path)
}
