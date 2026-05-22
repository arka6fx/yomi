import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { initMemoryDir } from "../memory/loader.js"

export interface Hooks {
  onSessionStart(): Promise<void>
  onUserPromptSubmit(prompt: string): Promise<void>
  onPreToolUse(toolName: string, args: unknown): Promise<{ ok: boolean; reason?: string }>
  onPostToolUse(toolName: string, result: unknown): Promise<unknown>
  onStop(summary: string): Promise<void>
  onSessionEnd(): Promise<void>
}

const DENYLIST = [
  /rm\s+-[rf]+\s+\//,              // rm -rf /
  /sudo\s+rm/,
  /chmod\s+[0-7]*7[0-7][0-7]/,    // chmod 777 / world-writable
  /curl[^|]+\|\s*(?:ba)?sh/,       // curl | sh
  /wget[^|]+\|\s*(?:ba)?sh/,       // wget | sh
]

// ~4000 tokens at ~4 chars/token
const TOOL_OUTPUT_MAX_CHARS = 16_000

function trimMiddle(text: string, maxChars: number): string {
  const head = Math.floor(maxChars * 0.5)
  const tail = Math.floor(maxChars * 0.3)
  return `${text.slice(0, head)}\n\n[...trimmed ${text.length - head - tail} chars...]\n\n${text.slice(-tail)}`
}

function todaySessionPath(): string {
  const d = new Date()
  const date = d.toISOString().slice(0, 10) // YYYY-MM-DD
  return join(homedir(), ".yomi", "sessions", `${date}-dev.md`)
}

export const hooks: Hooks = {
  async onSessionStart() {
    await initMemoryDir()
  },

  async onUserPromptSubmit(_prompt: string) {
    // reserved for future use (e.g. per-prompt context injection)
  },

  async onPreToolUse(toolName, args) {
    if (toolName === "bash") {
      const cmd =
        typeof args === "object" && args !== null && "command" in args
          ? String((args as Record<string, unknown>).command)
          : ""
      for (const pattern of DENYLIST) {
        if (pattern.test(cmd)) {
          return { ok: false, reason: `command matches denylist: "${cmd}"` }
        }
      }
    }
    return { ok: true }
  },

  async onPostToolUse(toolName, result) {
    const text = typeof result === "string" ? result : JSON.stringify(result)
    if (text.length > TOOL_OUTPUT_MAX_CHARS) {
      const trimmed = trimMiddle(text, TOOL_OUTPUT_MAX_CHARS)
      console.warn(`[yomi/hooks] trimmed ${toolName} output: ${text.length} → ${trimmed.length} chars`)
      return trimmed
    }
    return result
  },

  async onStop(summary) {
    const path = todaySessionPath()
    const hhmm = new Date().toTimeString().slice(0, 5)
    const line = `## ${hhmm} — ${summary}\n`
    try {
      await mkdir(join(homedir(), ".yomi", "sessions"), { recursive: true })
      await appendFile(path, line, "utf8")
    } catch (err) {
      console.warn("[yomi/hooks] onStop: failed to write session log:", err)
    }
  },

  async onSessionEnd() {
    // Compaction is triggered directly from agentPipeline after each run.
  },
}
