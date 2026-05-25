import { readFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const NOTEPAD = join(homedir(), ".yomi")

export function notepadDir(): string {
  return process.env["YOMI_NOTEPAD_DIR"] ?? NOTEPAD
}

export async function initMemoryDir(): Promise<void> {
  const root = notepadDir()
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(join(root, "projects"), { recursive: true }),
    mkdir(join(root, "sessions"), { recursive: true }),
  ])
}

export async function loadMemorySummary(): Promise<string> {
  try {
    return await readFile(join(notepadDir(), "memory.md"), "utf-8")
  } catch {
    return ""
  }
}

export async function loadMemoryIndex(): Promise<string> {
  try {
    return await readFile(join(notepadDir(), "memory-index.md"), "utf-8")
  } catch {
    return ""
  }
}
