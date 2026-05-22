// Stub hook implementations for spec 08.
// Full per-tool allowlist config, session logging, and compaction trigger land in spec 09.

const DENYLIST = [
  /rm\s+-[rf]+\s+\//,   // rm -rf /
  /sudo\s+rm/,
  /chmod\s+[0-7]*7[0-7][0-7]/,  // chmod 777 / world-writable
  /curl[^|]+\|\s*(?:ba)?sh/,     // curl | sh
  /wget[^|]+\|\s*(?:ba)?sh/,     // wget | sh
]

// ~4000 tokens at ~4 chars/token
const TOOL_OUTPUT_MAX_CHARS = 16_000

function trimMiddle(text: string, maxChars: number): string {
  const head = Math.floor(maxChars * 0.5)
  const tail = Math.floor(maxChars * 0.3)
  return `${text.slice(0, head)}\n\n[...trimmed ${text.length - head - tail} chars...]\n\n${text.slice(-tail)}`
}

export const hooks = {
  async preToolUse(
    toolName: string,
    args: unknown,
  ): Promise<{ ok: boolean; reason?: string }> {
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

  async postToolUse(toolName: string, result: unknown): Promise<unknown> {
    const text = typeof result === "string" ? result : JSON.stringify(result)
    if (text.length > TOOL_OUTPUT_MAX_CHARS) {
      const trimmed = trimMiddle(text, TOOL_OUTPUT_MAX_CHARS)
      console.warn(
        `[yomi/hooks] trimmed ${toolName} output: ${text.length} → ${trimmed.length} chars`,
      )
      return trimmed
    }
    return result
  },
}
