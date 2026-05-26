import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export const RAG_MAX_FILE_CHARS = 120_000
export const RAG_ALLOWED_EXTS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".yaml", ".yml"])

export function isInside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate)
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel)
}

export function assertRagUploadPath(filePath: string): void {
  const resolved = path.resolve(filePath)
  const notepad = path.join(homedir(), ".yomi")
  if (resolved === notepad || isInside(notepad, resolved)) {
    throw new Error("Yomi memory files cannot be uploaded to Cloud RAG")
  }
  if (!RAG_ALLOWED_EXTS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("Only text-like files are supported")
  }
}

export async function readRagFile(filePath: string): Promise<{ name: string; content: string; sizeBytes: number }> {
  assertRagUploadPath(filePath)
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error("Only files can be uploaded")
  if (info.size > RAG_MAX_FILE_CHARS * 4) throw new Error("File is too large for Cloud RAG")

  const raw = await readFile(filePath)
  if (raw.includes(0)) throw new Error("Binary files are not supported")
  const content = raw.toString("utf-8").slice(0, RAG_MAX_FILE_CHARS).trim()
  if (!content) throw new Error("File is empty")
  return { name: path.basename(filePath), content, sizeBytes: info.size }
}
