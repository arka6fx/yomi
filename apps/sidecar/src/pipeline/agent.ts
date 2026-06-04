import { streamText, type ToolSet } from "ai"
import type { AgentQueryRequest, Plan, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { createAgentTools } from "../tools/index.js"
import { hooks } from "../harness/hooks.js"
import { buildAgentPrompt, loadYomiMd } from "../harness/prompt.js"
import { LoopGuards } from "../harness/guards.js"
import { compact } from "../memory/compactor.js"
import { loadMemoryContext, writeSessionTurn } from "../memory/subsystem.js"
import { setActEmitter } from "../uia/act-bus.js"
import { getMcpTools } from "../mcp/client.js"
import { wrapBrowserTools } from "../mcp/safety.js"
import {
  adjustSystemVolume,
  adjustSpotifyVolume,
  playSpotify,
  sendWhatsAppMessage,
  type VolumeDirection,
} from "../tools/system.js"

const AGENT_PATH_MODEL = process.env.AGENT_PATH_MODEL || "gpt-4.1"
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "20", 10)

// yomi.md is stable per-session; memory files change after compaction so load fresh each turn.
let cachedYomiMd: string | null = null
function memoryEnabled(plan: Plan | undefined): boolean {
  return plan === "pro" || plan === "max"
}

async function getAgentPrompt(text: string, plan: Plan | undefined): Promise<string> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  const memory = memoryEnabled(plan)
  const memoryCtx = memory
    ? await loadMemoryContext(text)
    : {
        memorySummary: "",
        memoryIndex: "",
        localMemory: "",
        cloudRagContext: "",
        staticProfile: "",
        dynamicProfile: "",
        recentSession: "",
      }
  return buildAgentPrompt({ yomiMd: cachedYomiMd, ...memoryCtx })
}

function spotifyPlaybackQuery(text: string): string | null {
  if (!/\bplay\b/i.test(text)) return null
  // "play <something>" is treated as a Spotify request unless it's clearly video/other media.
  if (/\b(video|youtube|movie|film|episode|trailer|netflix|prime video)\b/i.test(text)) return null
  const playMatch =
    text.match(/\bplay\s+(.+?)(?:\s+(?:on|in)\s+spotify\b|$)/i) ??
    text.match(/\bspotify\s+(?:to\s+)?play\s+(.+?)$/i)
  const raw =
    playMatch?.[1] ??
    text.replace(/\b(open|launch|start)\s+spotify\b/gi, "").replace(/\bspotify\b/gi, "")
  const query = raw
    .replace(/\b(to\s+)?play\b/gi, "")
    .replace(/\b(on|in)\s+spotify\b/gi, "")
    .replace(/[.?!]+$/g, "")
    .trim()
  return query || null
}

function volumeAction(
  text: string,
): { direction: VolumeDirection; steps: number; target: "system" | "spotify" } | null {
  const t = text.toLowerCase()
  const mentionsSound = /\b(volume|sound|audio|louder|quieter|softer|mute|unmute|inc|dec)\b/.test(t)
  if (!mentionsSound) return null
  // "spotify" in the command → adjust Spotify's own volume; otherwise system-wide volume.
  const target = /\bspotify\b/.test(t) ? "spotify" : "system"
  const big = /\b(a lot|much|more)\b/.test(t)
  if (/\b(mute|unmute)\b/.test(t)) return { direction: "mute", steps: 1, target }
  if (/\b(increase|inc|raise|turn up|up|louder|boost)\b/.test(t))
    return { direction: "up", steps: big ? 5 : target === "spotify" ? 3 : 2, target }
  if (/\b(decrease|dec|lower|turn down|down|quieter|softer|reduce)\b/.test(t))
    return { direction: "down", steps: big ? 5 : target === "spotify" ? 3 : 2, target }
  return null
}

function whatsAppMessageRequest(text: string): { recipient: string; message: string } | null {
  if (!/\bwhats\s*app\b|\bwhatsapp\b/i.test(text)) return null
  const cleaned = text
    .replace(/^\s*(confirmed|confirm|yes)[,\s]+/i, "")
    .replace(/\b(open|launch|start)\s+whats\s*app\s*(?:and|to)?\s*/gi, "")
    .trim()
  const sendMatch = cleaned.match(
    /\bsend\s+["']?(.+?)["']?\s+to\s+(.+?)(?:\s+(?:on|in)\s+whats\s*app\b|\s*$)/i,
  )
  if (!sendMatch) return null
  const message = sendMatch[1]?.replace(/[.?!]+$/g, "").trim()
  const recipient = sendMatch[2]
    ?.replace(/\b(on|in)\s+whats\s*app\b/gi, "")
    .replace(/[.?!]+$/g, "")
    .trim()
  return message && recipient ? { recipient, message } : null
}

type ExecutableTool = { execute?: (args: unknown, opts: unknown) => PromiseLike<unknown> }
type AgentStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "step-finish" }
  | { type: "error"; error: unknown }
  | {
      type:
        | "reasoning"
        | "file"
        | "redacted-reasoning"
        | "reasoning-signature"
        | "source"
        | "tool-call-streaming-start"
        | "tool-call-delta"
        | "step-start"
        | "finish"
    }

// Wrap all tool execute functions with PreToolUse / PostToolUse hook calls.
function applyHooks(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
          const check = await hooks.onPreToolUse(name, args)
          if (!check.ok) {
            console.warn(`[yomi/agent] denied: ${name} — ${check.reason}`)
            return `[DENIED: ${check.reason}]`
          }
          const result = await (t as ExecutableTool).execute?.(args, opts)
          return hooks.onPostToolUse(name, result)
        },
      },
    ]),
  ) as ToolSet
}

// `emit` lets Act-mode tools push act_proposed/act_result onto the live SSE stream (Spec 16).
export async function* agentPipeline(
  req: AgentQueryRequest,
  opts?: { emit?: (e: SseEvent) => void },
): AsyncGenerator<SseEvent> {
  const system = await getAgentPrompt(req.text, req.plan)
  const guards = new LoopGuards()
  if (opts?.emit) setActEmitter(opts.emit)

  try {
    const volume = volumeAction(req.text)
    if (volume) {
      const spotify = volume.target === "spotify"
      const toolName = spotify ? "adjust_spotify_volume" : "adjust_volume"
      const args = { direction: volume.direction, steps: volume.steps }
      yield { type: "agent_tool_call", tool: toolName, args }
      const check = await hooks.onPreToolUse(toolName, args)
      const result = check.ok
        ? await hooks.onPostToolUse(
            toolName,
            spotify
              ? await adjustSpotifyVolume(volume.direction, volume.steps)
              : await adjustSystemVolume(volume.direction, volume.steps),
          )
        : `[DENIED: ${check.reason}]`
      yield { type: "agent_tool_result", tool: toolName, result }
      const failed = typeof result === "object" && result !== null && "error" in result
      yield {
        type: "agent_text",
        text: failed
          ? "I could not adjust the volume."
          : spotify
            ? "Spotify volume adjusted."
            : "Volume adjusted.",
      }
      await hooks.onStop(failed ? "volume adjustment failed" : "volume adjusted")
      yield { type: "done" }
      return
    }

    const spotifyQuery = spotifyPlaybackQuery(req.text)
    if (spotifyQuery) {
      yield { type: "agent_tool_call", tool: "play_spotify", args: { query: spotifyQuery } }
      const check = await hooks.onPreToolUse("play_spotify", { query: spotifyQuery })
      const result = check.ok
        ? await hooks.onPostToolUse("play_spotify", await playSpotify(spotifyQuery))
        : `[DENIED: ${check.reason}]`
      yield { type: "agent_tool_result", tool: "play_spotify", result }
      const failed = typeof result === "object" && result !== null && "error" in result
      yield {
        type: "agent_text",
        text: failed
          ? `I could not play ${spotifyQuery} on Spotify.`
          : `Playing ${spotifyQuery} on Spotify.`,
      }
      await hooks.onStop(failed ? "spotify playback failed" : "spotify playback started")
      yield { type: "done" }
      return
    }

    const whatsAppMessage = whatsAppMessageRequest(req.text)
    if (whatsAppMessage) {
      yield { type: "agent_tool_call", tool: "send_whatsapp_message", args: whatsAppMessage }
      const check = await hooks.onPreToolUse("send_whatsapp_message", whatsAppMessage)
      const result = check.ok
        ? await hooks.onPostToolUse(
            "send_whatsapp_message",
            await sendWhatsAppMessage(whatsAppMessage.recipient, whatsAppMessage.message),
          )
        : `[DENIED: ${check.reason}]`
      yield { type: "agent_tool_result", tool: "send_whatsapp_message", result }
      const failed = typeof result === "object" && result !== null && "error" in result
      yield {
        type: "agent_text",
        text: failed
          ? `I could not send "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`
          : `Sent "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`,
      }
      await hooks.onStop(failed ? "whatsapp send failed" : "whatsapp message sent")
      yield { type: "done" }
      return
    }

    // Build tools only for the full agent loop (not the fast-path returns above), so a "volume up"
    // command doesn't spawn the browser MCP. Browser tools merge in behind the same safety guard.
    const mcpTools = wrapBrowserTools(await getMcpTools())
    const tools = applyHooks({
      ...createAgentTools({ screenshotB64: req.screenshot_b64 }),
      ...mcpTools,
    })

    const result = streamText({
      model: createModel(AGENT_PATH_MODEL),
      system,
      // Prepend prior turns so follow-up commands in the conversational act loop have context.
      messages: [
        ...(req.history ?? []).map((h) => ({ role: h.role, content: h.text })),
        { role: "user" as const, content: req.text },
      ],
      tools,
      maxSteps: MAX_STEPS,
    })

    let stepCount = 0
    // Keep a rolling tail for the onStop summary (avoid unbounded accumulation).
    let textTail = ""

    for await (const event of result.fullStream as AsyncIterable<AgentStreamEvent>) {
      switch (event.type) {
        case "text-delta":
          textTail = (textTail + event.textDelta).slice(-200)
          yield { type: "agent_text", text: event.textDelta }
          break
        case "tool-call": {
          const guard = guards.onToolCall(event.toolName, event.args as Record<string, unknown>)
          yield {
            type: "agent_tool_call",
            tool: event.toolName,
            args: event.args as Record<string, unknown>,
          }
          if (guard.break) {
            yield { type: "error", message: guard.reason }
            await hooks.onStop(guard.reason)
            return
          }
          break
        }
        case "tool-result":
          yield { type: "agent_tool_result", tool: event.toolName, result: event.result }
          break
        case "step-finish": {
          stepCount++
          yield { type: "agent_step", iteration: stepCount, max: MAX_STEPS }
          const guard = guards.onStep()
          if (guard.break) {
            yield { type: "error", message: guard.reason }
            await hooks.onStop(guard.reason)
            return
          }
          break
        }
        case "error":
          yield {
            type: "error",
            message: event.error instanceof Error ? event.error.message : String(event.error),
          }
          return
      }
    }

    const summary = textTail.replace(/\n/g, " ").trim() || "agent task complete"
    await hooks.onStop(summary)
    if (memoryEnabled(req.plan)) {
      await writeSessionTurn({ kind: "agent", input: req.text, output: summary, summary })
      // Fire compaction after each agent run; it no-ops if the session log is too short.
      compact().catch((err) => console.warn("[yomi/agent] compaction error:", err))
    }
    yield { type: "done" }
  } finally {
    // Always detach the act emitter so a later run doesn't write to a dead stream.
    if (opts?.emit) setActEmitter(null)
  }
}
