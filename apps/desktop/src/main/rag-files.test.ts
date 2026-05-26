import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { assertRagUploadPath, readRagFile } from "./rag-files"

let tempDir: string | undefined

async function tempFile(name: string, content: string | Buffer): Promise<string> {
  tempDir ??= await mkdtemp(path.join(tmpdir(), "yomi-rag-files-"))
  const filePath = path.join(tempDir, name)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
  return filePath
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe("Cloud RAG file guards", () => {
  it("allows supported text-like extensions", () => {
    expect(() => assertRagUploadPath(path.join(tmpdir(), "notes.md"))).not.toThrow()
    expect(() => assertRagUploadPath(path.join(tmpdir(), "data.JSON"))).not.toThrow()
  })

  it("blocks local Yomi memory files", () => {
    const memoryPath = path.join(homedir(), ".yomi", "memory.md")

    expect(() => assertRagUploadPath(memoryPath)).toThrow("Yomi memory files cannot be uploaded")
  })

  it("blocks unsupported extensions", () => {
    expect(() => assertRagUploadPath(path.join(tmpdir(), "photo.png"))).toThrow("Only text-like files are supported")
  })

  it("reads and trims a valid text file", async () => {
    const filePath = await tempFile("source.txt", "\nUseful context\n")

    const file = await readRagFile(filePath)

    expect(file.name).toBe("source.txt")
    expect(file.content).toBe("Useful context")
    expect(file.sizeBytes).toBeGreaterThan(0)
  })

  it("rejects binary files", async () => {
    const filePath = await tempFile("binary.txt", Buffer.from([65, 0, 66]))

    await expect(readRagFile(filePath)).rejects.toThrow("Binary files are not supported")
  })

  it("rejects empty files", async () => {
    const filePath = await tempFile("empty.md", "   \n")

    await expect(readRagFile(filePath)).rejects.toThrow("File is empty")
  })
})
