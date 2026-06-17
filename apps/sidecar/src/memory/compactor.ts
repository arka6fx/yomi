import { generateText } from "ai"
import { readFile, writeFile, appendFile } from "node:fs/promises"
import { join } from "node:path"
import type { Plan } from "@yomi/shared"
import { createModel } from "../pipeline/model.js"
import { notepadDir } from "./loader.js"
import { scheduleCloudRagSync } from "./cloud-rag.js"
import { getDefaultCurator } from "../agent/curator.js"

const COMPACT_MODEL =
  process.env.COMPACT_MODEL || process.env.AI_CREDITS_FAST_MODEL || "gpt-5.5-mini"
// Minimum session log size before we bother calling the LLM.
const MIN_SESSION_CHARS = 200

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function sessionPath(date: string): string {
  return join(notepadDir(), "sessions", `${date}-dev.md`)
}

export async function compact(opts: { plan?: Plan | undefined } = {}): Promise<void> {
  const today = todayISO()

  const sessionLog = await readFile(sessionPath(today), "utf-8").catch(() => "")
  if (sessionLog.length < MIN_SESSION_CHARS) return

  const currentMemory = await readFile(join(notepadDir(), "memory.md"), "utf-8").catch(() => "")

  // Guard: don't compact the same day twice.
  if (currentMemory.includes(`## Recent context (${today})`)) return

  const { text } = await generateText({
    model: createModel(COMPACT_MODEL),
    messages: [
      {
        role: "user",
        content: `You maintain a personal AI assistant's long-term memory.

<session_log>
${sessionLog}
</session_log>

<current_memory>
${currentMemory || "(empty)"}
</current_memory>

Extract new facts, decisions, open threads, or preferences worth remembering. Only include information not already in current_memory. Be terse — one short bullet per item.

Format your output as:

## Recent context (${today})
- [bullet]

If nothing new worth adding, respond with exactly: NOTHING_NEW`,
      },
    ],
  })

  if (text.trim() === "NOTHING_NEW") return

  const memPath = join(notepadDir(), "memory.md")
  if (!currentMemory.trim()) {
    await writeFile(
      memPath,
      `# Long-term memory — [last updated: ${today}]\n\n${text.trim()}\n`,
      "utf-8",
    )
  } else {
    await appendFile(memPath, `\n\n${text.trim()}\n`, "utf-8")
  }

  // Add session entry to memory-index.md if not already present.
  const indexPath = join(notepadDir(), "memory-index.md")
  const indexEntry = `sessions/${today}-dev.md — Session summaries for ${today}\n`
  const existing = await readFile(indexPath, "utf-8").catch(() => "")
  if (!existing.includes(`sessions/${today}-dev.md`)) {
    await appendFile(indexPath, indexEntry, "utf-8")
  }
  scheduleCloudRagSync("compact")

  // Tail trigger: the curator's lifecycle + LLM review pass. Self-throttles
  // via .curator_state.last_run_at, so this is a near-no-op most of the
  // time. Errors are swallowed — a curator failure must never break
  // session-memory compaction.
  if (opts.plan) {
    getDefaultCurator()
      .maybeRunCurator({ plan: opts.plan })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[yomi/curator] error: ${msg}`)
      })
  }
}
