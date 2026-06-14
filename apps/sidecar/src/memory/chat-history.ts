import { appendFile, readFile, mkdir } from "node:fs/promises"
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
