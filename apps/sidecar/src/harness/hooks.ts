import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { initMemoryDir } from "../memory/loader.js"
import {
  appendGuidance,
  ToolCallGuardrailController,
  scanForThreats,
} from "../tools/guardrails/index.js"
import { getDefaultPluginManager } from "../plugins/plugin-manager.js"

// Focus tracking and tree-diff have been removed.
// Desktop automation is commented out — will be restored later.

export interface Hooks {
  onSessionStart(): Promise<void>
  onUserPromptSubmit(prompt: string): Promise<void>
  onPreToolUse(toolName: string, args: unknown): Promise<{ ok: boolean; reason?: string }>
  onPostToolUse(toolName: string, result: unknown, args?: unknown): Promise<unknown>
  onMemoryWrite?(content: string, metadata?: { source?: string; path?: string; kind?: string }): Promise<{ ok: boolean; reason?: string }>
  onStop(summary: string): Promise<void>
  onSessionEnd(): Promise<void>
}

const DENYLIST = [
  /rm\s+-[rf]+\s+\//, // rm -rf /
  /sudo\s+rm/,
  /chmod\s+[0-7]*7[0-7][0-7]/, // chmod 777 / world-writable
  /curl[^|]+\|\s*(?:ba)?sh/, // curl | sh
  /wget[^|]+\|\s*(?:ba)?sh/, // wget | sh
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

function toolArgsToText(args: unknown): string {
  if (typeof args === "string") return args
  if (args === undefined || args === null) return ""
  try {
    return JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  } catch {
    return String(args)
  }
}

function resultToText(result: unknown): string {
  if (typeof result === "string") return result
  if (result === undefined || result === null) return ""
  try {
    return JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  } catch {
    return String(result)
  }
}

// Shared per-turn guardrail controller. ReAct bursts (LangGraph execution / legacy
// agentPipeline) call resetForTurn() at the start of each streamText burst; LoopGuards
// reads `guardrail.haltDecision` in onStep() to break out of the burst.
const guardrail = new ToolCallGuardrailController()
export { guardrail as toolGuardrail }

// Build the default hooks, optionally chaining in plugin hooks.
function buildHooks(): Hooks {
  const base: Hooks = {
    async onSessionStart() {
      await initMemoryDir()
    },

    async onUserPromptSubmit(_prompt: string) {
      // reserved for future use (e.g. per-prompt context injection)
    },

    async onPreToolUse(toolName, args) {
      const guardrailDecision = guardrail.beforeCall(
        toolName,
        (args ?? {}) as Record<string, unknown>,
      )
      if (!guardrailDecision.allowsExecution) {
        return { ok: false, reason: guardrailDecision.message }
      }

      const text = toolArgsToText(args)
      if (text) {
        const findings = scanForThreats(text, "all")
        if (findings.length > 0) {
          return { ok: false, reason: `threat_block: ${findings[0]}` }
        }
      }

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

    async onPostToolUse(toolName, result, args) {
      const decision = guardrail.afterCall(toolName, (args ?? {}) as Record<string, unknown>, result)
      let out: unknown = decision.isWarn ? appendGuidance(result, decision) : result
      if (decision.action === "halt") {
        out = appendGuidance(result, decision)
      }

      const resultText = resultToText(out)
      if (resultText) {
        const findings = scanForThreats(resultText, "context")
        if (findings.length > 0) {
          console.warn(`[yomi/hooks] threat pattern(s) in ${toolName} output: ${findings.join(", ")}`)
        }
      }

      if (resultText.length > TOOL_OUTPUT_MAX_CHARS) {
        const trimmed = trimMiddle(resultText, TOOL_OUTPUT_MAX_CHARS)
        console.warn(
          `[yomi/hooks] trimmed ${toolName} output: ${resultText.length} → ${trimmed.length} chars`,
        )
        return trimmed
      }
      return out
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

  // Merge plugin hooks into the chain. Plugin hooks run after the guardrail /
  // threat checks but before the final output trim. The plugin manager may be
  // uninitialised (loaded lazily from index.ts), so guard.
  let pluginHooks: Partial<Hooks> = {}
  try {
    pluginHooks = getDefaultPluginManager().getPluginHooks()
  } catch {
    // Plugin manager not loaded — use base hooks
  }

  if (pluginHooks.onPreToolUse) {
    const orig = base.onPreToolUse.bind(base)
    base.onPreToolUse = async (toolName, args) => {
      const r = await orig(toolName, args)
      if (!r.ok) return r
      return pluginHooks.onPreToolUse!(toolName, args)
    }
  }
  if (pluginHooks.onPostToolUse) {
    const orig = base.onPostToolUse.bind(base)
    base.onPostToolUse = async (toolName, result, args) => {
      const r = await orig(toolName, result, args)
      return pluginHooks.onPostToolUse!(toolName, r, args)
    }
  }
  if (pluginHooks.onSessionStart) {
    const orig = base.onSessionStart.bind(base)
    base.onSessionStart = async () => { await orig(); await pluginHooks.onSessionStart!() }
  }
  if (pluginHooks.onSessionEnd) {
    const orig = base.onSessionEnd.bind(base)
    base.onSessionEnd = async () => { await orig(); await pluginHooks.onSessionEnd!() }
  }
  if (pluginHooks.onUserPromptSubmit) {
    const orig = base.onUserPromptSubmit.bind(base)
    base.onUserPromptSubmit = async (p) => { await orig(p); await pluginHooks.onUserPromptSubmit!(p) }
  }
  if (pluginHooks.onStop) {
    const orig = base.onStop.bind(base)
    base.onStop = async (s) => { await orig(s); await pluginHooks.onStop!(s) }
  }
  if (pluginHooks.onMemoryWrite) {
    const orig = base.onMemoryWrite?.bind(base) ?? (async () => ({ ok: true } as const))
    base.onMemoryWrite = async (content, metadata) => {
      const r = await orig(content, metadata)
      if (!r.ok) return r
      return pluginHooks.onMemoryWrite!(content, metadata)
    }
  }

  return base
}

export const hooks: Hooks = buildHooks()
