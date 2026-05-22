import { readFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const NOTEPAD = join(homedir(), ".yomi")

export async function initMemoryDir(): Promise<void> {
  await Promise.all([
    mkdir(join(NOTEPAD, "projects"), { recursive: true }),
    mkdir(join(NOTEPAD, "sessions"), { recursive: true }),
  ])
}

export async function loadMemorySummary(): Promise<string> {
  try {
    return await readFile(join(NOTEPAD, "memory.md"), "utf-8")
  } catch {
    return ""
  }
}

export async function loadMemoryIndex(): Promise<string> {
  try {
    return await readFile(join(NOTEPAD, "memory-index.md"), "utf-8")
  } catch {
    return ""
  }
}
