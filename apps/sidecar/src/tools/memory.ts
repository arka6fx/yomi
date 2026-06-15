import { tool, jsonSchema } from "ai"
import { join } from "path"
import { homedir } from "os"
import { readdir, readFile, writeFile, mkdir } from "fs/promises"

const SESSIONS_DIR = join(homedir(), ".yomi", "sessions")

const NOTEPAD = join(homedir(), ".yomi")

type RgJsonLine = RgMatchLine | { type: string }
type RgMatchLine = {
  type: "match"
  data: {
    path: { text: string }
    line_number: number
    lines: { text: string }
  }
}

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
          return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
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
        const proc = Bun.spawn(["rg", "--json", "--max-count", "3", query, NOTEPAD], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const out = await new Response(proc.stdout).text()
        await proc.exited
        const matches = out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as RgJsonLine
            } catch {
              return null
            }
          })
          .filter((item): item is RgMatchLine => item !== null && item.type === "match")
          .map((item) => ({
            file: item.data.path.text,
            line: item.data.line_number,
            text: item.data.lines.text.trim(),
          }))
        return matches.length > 0 ? matches : { message: "No results found" }
      },
    }),

    search_sessions: tool({
      description:
        "Search past conversation sessions for a topic, decision, or prior answer. Returns matching turns with surrounding context. Use when the user references something from a previous conversation.",
      parameters: jsonSchema<{ query: string; limit?: number }>({
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms or phrase to find in past sessions" },
          limit: {
            type: "number",
            description: "Max number of matching turns to return (default 5)",
          },
        },
        required: ["query"],
      }),
      execute: async ({ query, limit = 5 }) => {
        // ripgrep with context lines over the sessions directory
        const proc = Bun.spawn(
          [
            "rg",
            "--json",
            "--max-count",
            String(limit),
            "--context",
            "3",
            "--ignore-case",
            query,
            SESSIONS_DIR,
          ],
          { stdout: "pipe", stderr: "pipe" },
        )
        const out = await new Response(proc.stdout).text()
        await proc.exited

        type RgLine =
          | { type: "match"; data: { path: { text: string }; line_number: number; lines: { text: string } } }
          | { type: "context"; data: { path: { text: string }; line_number: number; lines: { text: string } } }
          | { type: string }

        const lines = out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try { return JSON.parse(l) as RgLine } catch { return null }
          })
          .filter((l): l is RgLine => l !== null && (l.type === "match" || l.type === "context"))

        if (lines.length === 0) return { message: "No sessions matched." }

        // Group consecutive lines into snippets separated by file boundary or gap
        const snippets: Array<{ file: string; lines: string[] }> = []
        let current: { file: string; lines: string[] } | null = null
        for (const l of lines) {
          const entry = l as { type: string; data: { path: { text: string }; line_number: number; lines: { text: string } } }
          const file = entry.data.path.text.replace(SESSIONS_DIR, "sessions")
          if (!current || current.file !== file) {
            current = { file, lines: [] }
            snippets.push(current)
          }
          current.lines.push(entry.data.lines.text.trimEnd())
        }

        return snippets.slice(0, limit).map((s) => ({
          session: s.file,
          excerpt: s.lines.join("\n"),
        }))
      },
    }),
  }
}
