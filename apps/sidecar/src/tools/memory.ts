import { tool, jsonSchema } from "ai"
import { join } from "path"
import { homedir } from "os"
import { readdir, readFile, writeFile, mkdir } from "fs/promises"

const NOTEPAD = join(homedir(), ".yomi")

async function ensureParentDir(filePath: string) {
  await mkdir(join(filePath, ".."), { recursive: true })
}

export function createMemoryTools() {
  return {
    list_files: tool({
      description: "List files in the notepad directory (~/.yomi/)",
      parameters: jsonSchema<{ dir: string }>({
        type: "object",
        properties: {
          dir: { type: "string", description: "Subdirectory relative to ~/.yomi/", default: "" },
        },
        required: [],
      }),
      execute: async ({ dir }) => {
        const target = join(NOTEPAD, dir ?? "")
        try {
          const entries = await readdir(target, { withFileTypes: true })
          return entries.map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
        } catch {
          return { error: `Cannot read directory: ${dir || "~/.yomi/"}` }
        }
      },
    }),

    read_file: tool({
      description: "Read a file from the notepad (~/.yomi/)",
      parameters: jsonSchema<{ path: string }>({
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to ~/.yomi/" },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        try {
          return await readFile(join(NOTEPAD, path), "utf-8")
        } catch {
          return { error: `File not found: ${path}` }
        }
      },
    }),

    write_file: tool({
      description: "Write content to a file in the notepad (~/.yomi/)",
      parameters: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to ~/.yomi/" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        const full = join(NOTEPAD, path)
        await ensureParentDir(full)
        await writeFile(full, content, "utf-8")
        return { ok: true, path }
      },
    }),

    search: tool({
      description: "Search for text across all notepad files (~/.yomi/) using ripgrep",
      parameters: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      }),
      execute: async ({ query }) => {
        const proc = Bun.spawn(
          ["rg", "--json", "--max-count", "3", query, NOTEPAD],
          { stdout: "pipe", stderr: "pipe" },
        )
        const out = await new Response(proc.stdout).text()
        await proc.exited
        const matches = out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(line => { try { return JSON.parse(line) } catch { return null } })
          .filter((item): item is Record<string, unknown> => item !== null && (item as any).type === "match")
          .map((item: any) => ({
            file: item.data?.path?.text,
            line: item.data?.line_number,
            text: item.data?.lines?.text?.trim(),
          }))
        return matches.length > 0 ? matches : { message: "No results found" }
      },
    }),
  }
}
