import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { NOTEPAD } from "./loader.js"

export async function readScratchpad(projectSlug = "default"): Promise<string> {
  try {
    return await readFile(join(NOTEPAD, "projects", projectSlug, "scratchpad.md"), "utf-8")
  } catch {
    return ""
  }
}

export async function writeScratchpad(projectSlug: string, content: string): Promise<void> {
  const dir = join(NOTEPAD, "projects", projectSlug)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "scratchpad.md"), content, "utf-8")
}
