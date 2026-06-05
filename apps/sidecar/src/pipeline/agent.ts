import { streamText, type ToolSet } from "ai"
import type { AgentQueryRequest, Plan, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { createAgentTools } from "../tools/index.js"
import { hooks, type Hooks } from "../harness/hooks.js"
import { buildAgentPrompt, loadYomiMd } from "../harness/prompt.js"
import { LoopGuards } from "../harness/guards.js"
import { compact } from "../memory/compactor.js"
import { loadMemoryContext, writeSessionTurn } from "../memory/subsystem.js"
import { setActEmitter } from "../uia/act-bus.js"
import { getMcpTools } from "../mcp/client.js"
import { wrapBrowserTools } from "../mcp/safety.js"
import {
  completeAutomation,
  failAutomation,
  previewAutomation,
  redactAutomationPayload,
  startAutomationRun,
  stepAutomation,
  timelineAutomation,
  waitingAutomation,
} from "../automation/runs.js"
import {
  adjustSystemVolume,
  adjustSpotifyVolume,
  controlSpotifyPlayback,
  playSpotify,
  sendWhatsAppMessage,
  writeWindowsNotepad,
  type SpotifyControl,
  type VolumeDirection,
} from "../tools/system.js"

const AGENT_PATH_MODEL = process.env.AGENT_PATH_MODEL || "gpt-4.1"
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "20", 10)

let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null
let pendingWindowsNotepadDraft = false

export function __resetAgentShortcutStateForTest(): void {
  pendingWhatsAppDraft = null
  pendingWindowsNotepadDraft = false
}

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

// Phrases that mean "do this without stealing my focus". Used both to detect background intent and
// to strip the phrase before parsing the actual command (so "play X in the background" → query "X").
const BACKGROUND_PATTERNS: RegExp[] = [
  /\bin\s+the\s+background\b/gi,
  /\bin\s+bg\b/gi,
  /\bbehind\s+the\s+scenes\b/gi,
  /\bwithout\s+switching\b/gi,
  /\bwithout\s+interrupting(?:\s+me)?\b/gi,
  /\bwhile\s+i\s+(?:keep|am)\s+working\b/gi,
  /\bdon'?t\s+switch\s+away\b/gi,
  /\bquietly\b/gi,
]

function detectBackgroundMode(text: string): boolean {
  return BACKGROUND_PATTERNS.some((re) => {
    re.lastIndex = 0
    return re.test(text)
  })
}

function stripBackgroundPhrase(text: string): string {
  let out = text
  for (const re of BACKGROUND_PATTERNS) out = out.replace(re, " ")
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([.?!,])/g, "$1")
    .trim()
}

// Spotify transport (pause/resume/next/previous/stop) — driven by media keys. Matches either an
// explicit music context ("next song", "skip spotify") or a short bare transport command
// ("play the next", "previous", "skip") — but not phrases like "what's next on my calendar".
function playbackControl(text: string): SpotifyControl | null {
  const t = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim()
  const musicCtx = /\b(spotify|music|song|track|playback|tune)\b/.test(t)

  // "next", "play the next", "play next song", "skip", "next track", "skip this song"
  if (
    /^(?:play |go to |skip to )?(?:the )?next(?: song| track| one)?$/.test(t) ||
    /\bnext (?:song|track)\b/.test(t) ||
    /\bskip(?: this)?(?: song| track)?$/.test(t) ||
    (musicCtx && /\b(next|skip)\b/.test(t))
  )
    return "next"

  // "previous", "play the previous", "prev song", "go back a song"
  if (
    /^(?:play |go to )?(?:the )?(?:previous|prev|last)(?: song| track| one)?$/.test(t) ||
    /\b(?:previous|prev) (?:song|track)\b/.test(t) ||
    /\bgo back (?:a |one )?(?:song|track)\b/.test(t) ||
    (musicCtx && /\b(previous|prev)\b/.test(t))
  )
    return "previous"

  if (/^pause$/.test(t) || (musicCtx && /\bpause\b/.test(t))) return "pause"
  if (/^(?:resume|unpause|continue)$/.test(t) || (musicCtx && /\b(resume|unpause|continue)\b/.test(t)))
    return "resume"
  if (musicCtx && /\bstop\b/.test(t)) return "stop"
  return null
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
    .replace(/\b(song|track|music)\b/gi, "")
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
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

function normalizeSpokenRecipient(raw: string): string {
  const trimmed = raw.replace(/^\s*(?:my|the|a|an)\s+/i, "").replace(/[.?!,]+$/g, "").trim()
  if (/^(?:me|myself|self|you|message\s*myself|send\s*to\s*myself)$/i.test(trimmed)) return "you"
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return trimmed
  const relation =
    /^(?:mom|mum|mother|mummy|ma|dad|father|papa|brother|sister|wife|husband|partner|friend)$/i
  return relation.test(parts[0] ?? "") ? parts.slice(1).join(" ") : trimmed
}

function reminderDraftRequest(text: string): { message: string } | null {
  if (!/\bwhats\s*app\b|\bwhatsapp\b/i.test(text)) return null
  if (!/\b(reminder|remainder)\b/i.test(text)) return null
  if (!/\b(write|draft|make|create|note)\b/i.test(text)) return null
  const cleaned = text
    .replace(/[.?!]+$/g, "")
    .replace(/\b(?:and\s+)?(?:send|share|message)\s+(?:it\s+)?(?:to\s+)?(?:whats\s*app|whatsapp)\b/gi, "")
    .replace(/\b(?:on|in|via|through|using)\s+(?:whats\s*app|whatsapp)\b/gi, "")
    .trim()
  const m =
    cleaned.match(/\b(?:reminder|remainder)\s+(?:about|for|to)\s+(.+)$/i) ??
    cleaned.match(/\b(?:write|draft|make|create|note)\s+(?:a\s+)?(?:reminder|remainder)\s+(.+)$/i)
  const topic = m?.[1]?.replace(/^\s*(?:about|for|to)\s+/i, "").trim()
  return topic ? { message: `Reminder: ${topic}` } : null
}

function isWindowsNotepadSaveFollowup(text: string): boolean {
  if (!pendingWindowsNotepadDraft) return false
  return /\b(save|store)\s+(?:it|this|that|the\s+(?:note|file|draft))\b/i.test(text.trim())
}

function stripNotepadTarget(text: string): string {
  return text
    .replace(/\b(?:in|into|on|to|inside)\s+(?:the\s+)?(?:windows\s+)?notepad\b/gi, " ")
    .replace(/\b(?:open|launch|start)\s+(?:the\s+)?(?:windows\s+)?notepad(?:\s+(?:and|to))?\b/gi, " ")
    .replace(/\b(?:write|wright|type|put|draft|make|create|note)\s+(?:down\s+)?(?:this\s+)?/gi, " ")
    .replace(/\b(?:and\s+)?(?:save|store)\s+(?:it|this|that|the\s+(?:note|file|draft))\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/g, "")
    .trim()
}

export function windowsNotepadRequest(text: string): { content: string; needsMemory: boolean; wantsSave: boolean } | null {
  if (!/\b(?:the\s+)?(?:windows\s+)?notepad\b/i.test(text)) return null
  const wantsWrite = /\b(write|wright|type|put|draft|make|create|note)\b/i.test(text)
  const wantsSave = /\b(save|store)\b/i.test(text)
  const asksKnownAboutMe =
    /\b(?:(?:what|things|stuff|struffs)\s+you|thingsyou)\s+(?:know|knoe)\s+about\s+me\b/i.test(
      text,
    )
  if (!wantsWrite && !wantsSave && !asksKnownAboutMe) return null

  const content = stripNotepadTarget(text)
  return {
    content,
    needsMemory: asksKnownAboutMe,
    wantsSave,
  }
}

function pendingDraftRecipientRequest(text: string): string | null {
  if (!pendingWhatsAppDraft) return null
  if (!/\b(send|share|message|msg|text|whats\s*app|whatsapp)\b/i.test(text)) return null
  const cleaned = text.replace(/[.?!]+$/g, "").trim()
  const draftRef =
    /\b(reminder|remainder|it|that|this|draft|message|msg|text)\b/i.test(cleaned) ||
    /\b(?:i\s+)?(?:told|asked)\s+(?:you|it)\s+to\s+send\b/i.test(cleaned)
  const m =
    cleaned.match(
      /\b(?:send|share)\s+(?:the\s+)?(?:reminder|remainder|draft|message|msg|text|it|that|this)(?:\s+(?:i\s+)?(?:told|asked)\s+(?:you|it)\s+to\s+send)?\s+to\s+(.+?)(?:\s+(?:on|in|via|through|using)\s+(?:whats\s*app|whatsapp)\b|$)/i,
    ) ??
    cleaned.match(
      /\b(?:send|share|message|msg|text|whats\s*app|whatsapp)\s+(?:the\s+)?(?:reminder|remainder|draft|message|msg|text|it|that|this)\s+(.+)$/i,
    ) ??
    cleaned.match(
      /\b(?:send|share|message|msg|text|whats\s*app|whatsapp)\s+(?:to\s+)?(.+?)(?:\s+(?:on|in|via|through|using)\s+(?:whats\s*app|whatsapp)\b|$)/i,
    )
  if (!m?.[1]) return null
  if (!draftRef && !/^(?:me|myself|self|you)$/i.test(m[1].trim())) return null
  return normalizeSpokenRecipient(m[1])
}

// Parse a WhatsApp send command from natural phrasing. Handles "send <msg> to <name>",
// "text/message/tell <name> saying/that/: <msg>", and bare "text/message <name> <msg>" (name = first
// word, or "my <x>"). Ambiguous phrasings return null and fall through to the LLM agent loop, which
// has the send_whatsapp_message tool. The recipient name still gets verified by the spoken confirm.
export function whatsAppMessageRequest(text: string): { recipient: string; message: string } | null {
  const cleaned = text
    .replace(/[.?!]+$/g, "")
    .replace(/^\s*(please|hey|ok|okay|yomi)[,\s]+/i, "")
    .replace(/\b(open|launch|start)\s+whats\s*app\s*(?:and|to)?\s*/gi, "")
    .replace(/\b(on|in|over|via|through|using)\s+whats\s*app\b/gi, "")
    .trim()

  const finish = (recipient: string, message: string) => {
    const r = normalizeSpokenRecipient(recipient)
    const msg = message
      .replace(/^["']|["']$/g, "")
      .replace(/[.?!]+$/g, "")
      .trim()
    return r && msg ? { recipient: r, message: msg } : null
  }

  // "send <msg> to <name>"
  let m = cleaned.match(/\bsend\s+["']?(.+?)["']?\s+to\s+(.+)$/i)
  if (m?.[1] && m[2]) return finish(m[2], m[1])

  // "<verb> <name> (saying|that|to say|:|,|-) <msg>" — separator makes the split unambiguous.
  m = cleaned.match(
    /\b(?:text|message|msg|tell|ping|whats\s*app|whatsapp)\s+(.+?)\s+(?:saying|that|to say|:|,|-)\s+(.+)$/i,
  )
  if (m?.[1] && m[2]) return finish(m[1], m[2])

  // Bare "<verb> <name> <msg>" — only the clearly-messaging verbs, name = first word (or "my <x>").
  m = cleaned.match(/\b(?:text|message|msg|whats\s*app|whatsapp)\s+(.+)$/i)
  if (m?.[1]) {
    const words = m[1].trim().split(/\s+/)
    const nameWords = /^my$/i.test(words[0] ?? "") ? 2 : 1
    if (words.length > nameWords)
      return finish(words.slice(0, nameWords).join(" "), words.slice(nameWords).join(" "))
  }
  return null
}

type WriteSessionTurn = typeof writeSessionTurn
type ShortcutSystemActions = {
  adjustSystemVolume: typeof adjustSystemVolume
  adjustSpotifyVolume: typeof adjustSpotifyVolume
  controlSpotifyPlayback: typeof controlSpotifyPlayback
  playSpotify: typeof playSpotify
  sendWhatsAppMessage: typeof sendWhatsAppMessage
  writeWindowsNotepad: typeof writeWindowsNotepad
}

async function notepadKnownAboutMeText(plan: Plan | undefined): Promise<string> {
  if (!memoryEnabled(plan)) {
    return "I do not have Yomi memory enabled for this plan, so I do not have saved personal notes to summarize yet."
  }
  const ctx = await loadMemoryContext("what you know about me user profile preferences facts")
  const sections: Array<[string, string]> = [
    ["Static profile", ctx.staticProfile] as [string, string],
    ["Dynamic profile", ctx.dynamicProfile] as [string, string],
    ["Memory summary", ctx.memorySummary] as [string, string],
    ["Relevant memories", ctx.localMemory] as [string, string],
  ].filter(([, value]) => value.trim())

  if (sections.length === 0) {
    return "I do not have saved personal notes about you yet. Tell me what to add, and I can write it here."
  }

  return sections.map(([label, value]) => `${label}\n${value.trim()}`).join("\n\n")
}

async function rememberAgentShortcut(
  req: AgentQueryRequest,
  output: string,
  writeTurn: WriteSessionTurn,
): Promise<void> {
  if (!memoryEnabled(req.plan)) return
  await writeTurn({ kind: "agent", input: req.text, output, summary: output })
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

function shortcutFailed(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (("error" in result) || ("ok" in result && (result as { ok?: unknown }).ok === false))
  )
}

// Wrap all tool execute functions with PreToolUse / PostToolUse hook calls.
function applyHooks(tools: ToolSet, activeHooks: Hooks): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
          const check = await activeHooks.onPreToolUse(name, args)
          if (!check.ok) {
            console.warn(`[yomi/agent] denied: ${name} — ${check.reason}`)
            return `[DENIED: ${check.reason}]`
          }
          const result = await (t as ExecutableTool).execute?.(args, opts)
          return activeHooks.onPostToolUse(name, result)
        },
      },
    ]),
  ) as ToolSet
}

// `emit` lets Act-mode tools push act_proposed/act_result onto the live SSE stream (Spec 16).
export async function* agentPipeline(
  req: AgentQueryRequest,
  opts?: {
    emit?: (e: SseEvent) => void
    hooks?: Hooks
    system?: ShortcutSystemActions
    writeSessionTurn?: WriteSessionTurn
    signal?: AbortSignal
  },
): AsyncGenerator<SseEvent> {
  const system = await getAgentPrompt(req.text, req.plan)
  const automation = startAutomationRun(req.text)
  let automationClosed = false
  for (const event of automation.events) yield event
  yield previewAutomation(automation)
  yield timelineAutomation(automation, "Prepared automation preview", "planned")
  const closeAutomation = (summary: string, failed = false): SseEvent => {
    automationClosed = true
    return failed ? failAutomation(automation, summary) : completeAutomation(automation, summary)
  }
  const guards = new LoopGuards()
  const activeHooks = opts?.hooks ?? hooks
  // When the desktop barges in (talk-to-interrupt) the fetch aborts; honor it so a superseded run
  // stops driving apps and releases the shared UIA helper instead of running on as a zombie.
  const signal = opts?.signal
  const systemActions = opts?.system ?? {
    adjustSystemVolume,
    adjustSpotifyVolume,
    controlSpotifyPlayback,
    playSpotify,
    sendWhatsAppMessage,
    writeWindowsNotepad,
  }
  const writeTurn = opts?.writeSessionTurn ?? writeSessionTurn
  if (opts?.emit)
    setActEmitter((event) => {
      if (event.type === "act_proposed") {
        opts.emit?.(waitingAutomation(automation, event.label, "dangerous"))
        opts.emit?.(timelineAutomation(automation, `Waiting for approval: ${event.label}`, "waiting"))
      } else if (event.type === "act_result") {
        opts.emit?.(
          timelineAutomation(
            automation,
            event.label,
            event.ok ? "done" : "failed",
            event.detail,
          ),
        )
      }
      opts.emit?.(event)
    })

  try {
    // Already superseded before we did anything — exit quietly, no red error.
    if (signal?.aborted) {
      yield closeAutomation("Automation cancelled.", true)
      yield { type: "done" }
      return
    }

    // "...in the background" → drive apps without stealing focus; strip the phrase before parsing.
    const background = req.background ?? detectBackgroundMode(req.text)
    const cleanText = background ? stripBackgroundPhrase(req.text) : req.text

    if (isWindowsNotepadSaveFollowup(cleanText)) {
      const output = "Where should I save the Notepad file, and what should I name it?"
      yield waitingAutomation(automation, output, "moderate")
      yield timelineAutomation(automation, output, "waiting")
      yield { type: "agent_text", text: output }
      await activeHooks.onStop("notepad save location needed")
      yield closeAutomation("Waiting for save location.")
      yield { type: "done" }
      return
    }

    // Spotify transport (pause/resume/next/previous/stop) via media keys — true background.
    const control = playbackControl(cleanText)
    if (control) {
      const args = { action: control }
      yield stepAutomation(automation, "Control Spotify playback")
      yield timelineAutomation(automation, "Control Spotify playback", "running")
      yield { type: "agent_tool_call", tool: "control_spotify", args }
      const check = await activeHooks.onPreToolUse("control_spotify", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "control_spotify",
            await systemActions.controlSpotifyPlayback(control),
          )
        : `[DENIED: ${check.reason}]`
      yield { type: "agent_tool_result", tool: "control_spotify", result }
      const failed = typeof result === "object" && result !== null && "error" in result
      const verb =
        control === "next"
          ? "Skipped to the next track"
          : control === "previous"
            ? "Went to the previous track"
            : control === "stop"
              ? "Stopped playback"
              : control === "resume"
                ? "Resumed Spotify"
                : "Paused Spotify"
      const output = failed ? "I could not control Spotify playback." : `${verb}.`
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "spotify control failed" : "spotify control done")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const volume = volumeAction(cleanText)
    if (volume) {
      const spotify = volume.target === "spotify"
      const toolName = spotify ? "adjust_spotify_volume" : "adjust_volume"
      const args = { direction: volume.direction, steps: volume.steps }
      yield stepAutomation(automation, spotify ? "Adjust Spotify volume" : "Adjust system volume")
      yield timelineAutomation(
        automation,
        spotify ? "Adjust Spotify volume" : "Adjust system volume",
        "running",
      )
      yield { type: "agent_tool_call", tool: toolName, args }
      const check = await activeHooks.onPreToolUse(toolName, args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            toolName,
            spotify
              ? await systemActions.adjustSpotifyVolume(volume.direction, volume.steps, {
                  background,
                  signal,
                })
              : await systemActions.adjustSystemVolume(volume.direction, volume.steps),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: toolName, result }
      const failed = typeof result === "object" && result !== null && "error" in result
      const output = failed
        ? "I could not adjust the volume."
        : spotify
          ? "Spotify volume adjusted."
          : "Volume adjusted."
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "volume adjustment failed" : "volume adjusted")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const spotifyQuery = spotifyPlaybackQuery(cleanText)
    if (spotifyQuery) {
      yield stepAutomation(automation, `Play ${spotifyQuery} on Spotify`)
      yield timelineAutomation(automation, `Play ${spotifyQuery} on Spotify`, "running")
      yield { type: "agent_tool_call", tool: "play_spotify", args: { query: spotifyQuery } }
      const check = await activeHooks.onPreToolUse("play_spotify", { query: spotifyQuery })
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "play_spotify",
            await systemActions.playSpotify(spotifyQuery, { background, signal }),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "play_spotify", result }
      const failed = typeof result === "object" && result !== null && "error" in result
      const foregrounded =
        typeof result === "object" && result !== null && "foregroundedFallback" in result
      const output = failed
        ? `I could not play ${spotifyQuery} on Spotify.`
        : foregrounded
          ? `Playing ${spotifyQuery} on Spotify — I brought it up for a moment to start it.`
          : `Playing ${spotifyQuery} on Spotify.`
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "spotify playback failed" : "spotify playback started")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const notepadReq = windowsNotepadRequest(cleanText)
    if (notepadReq) {
      const content = notepadReq.needsMemory
        ? await notepadKnownAboutMeText(req.plan)
        : notepadReq.content
      if (!content.trim()) {
        const output = "What should I write in Notepad?"
        yield waitingAutomation(automation, output, "moderate")
        yield timelineAutomation(automation, output, "waiting")
        yield { type: "agent_text", text: output }
        await activeHooks.onStop("notepad content needed")
        yield closeAutomation("Waiting for Notepad content.")
        yield { type: "done" }
        return
      }
      const args = { text: content }
      yield { type: "agent_tool_call", tool: "write_windows_notepad", args }
      const check = await activeHooks.onPreToolUse("write_windows_notepad", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "write_windows_notepad",
            await systemActions.writeWindowsNotepad(content),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "write_windows_notepad", result }
      const failed = shortcutFailed(result)
      const output = failed
        ? "I opened Windows Notepad, but could not write into it."
        : notepadReq.wantsSave
          ? "I wrote it in Windows Notepad. Where should I save the file, and what should I name it?"
          : "I wrote it in Windows Notepad."
      if (!failed) pendingWindowsNotepadDraft = true
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "notepad write failed" : "notepad draft written")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const pendingRecipient = pendingDraftRecipientRequest(cleanText)
    if (pendingRecipient && pendingWhatsAppDraft) {
      const draft = pendingWhatsAppDraft
      const args = { recipient: pendingRecipient, message: draft.message }
      yield { type: "agent_tool_call", tool: "send_whatsapp_message", args }
      const check = await activeHooks.onPreToolUse("send_whatsapp_message", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "send_whatsapp_message",
            await systemActions.sendWhatsAppMessage(pendingRecipient, draft.message, {
              background,
              signal,
            }),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "send_whatsapp_message", result }
      const failed = shortcutFailed(result)
      const errText =
        failed && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : null
      const output = failed
        ? (errText ?? `I could not send the reminder to ${pendingRecipient} on WhatsApp.`)
        : `Sent the reminder to ${pendingRecipient} on WhatsApp.`
      if (!failed) pendingWhatsAppDraft = null
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "whatsapp reminder send failed" : "whatsapp reminder sent")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const whatsAppMessage = whatsAppMessageRequest(cleanText)
    if (whatsAppMessage) {
      yield { type: "agent_tool_call", tool: "send_whatsapp_message", args: whatsAppMessage }
      const check = await activeHooks.onPreToolUse("send_whatsapp_message", whatsAppMessage)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "send_whatsapp_message",
            await systemActions.sendWhatsAppMessage(
              whatsAppMessage.recipient,
              whatsAppMessage.message,
              { background, signal },
            ),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "send_whatsapp_message", result }
      const failed = shortcutFailed(result)
      // On failure speak the actual reason/question (e.g. "who should I message?") so the user can
      // clarify, rather than a generic "couldn't send".
      const errText =
        failed && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : null
      const output = failed
        ? (errText ??
          `I could not send "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`)
        : `Sent "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "whatsapp send failed" : "whatsapp message sent")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const reminderDraft = reminderDraftRequest(cleanText)
    if (reminderDraft) {
      pendingWhatsAppDraft = { kind: "reminder", message: reminderDraft.message }
      const output = `I wrote: "${reminderDraft.message}". Who should I send it to on WhatsApp?`
      yield waitingAutomation(automation, "Waiting for WhatsApp recipient", "moderate")
      yield timelineAutomation(automation, "Drafted WhatsApp reminder", "done")
      yield { type: "agent_text", text: output }
      await activeHooks.onStop("whatsapp reminder recipient needed")
      yield closeAutomation("Waiting for WhatsApp recipient.")
      yield { type: "done" }
      return
    }

    // Build tools only for the full agent loop (not the fast-path returns above), so a "volume up"
    // command doesn't spawn the browser MCP. Browser tools merge in behind the same safety guard.
    const mcpTools = wrapBrowserTools(await getMcpTools())
    const tools = applyHooks(
      {
        ...createAgentTools({ screenshotB64: req.screenshot_b64, background }),
        ...mcpTools,
      },
      activeHooks,
    )

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
      abortSignal: signal,
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
          yield stepAutomation(automation, `Using ${event.toolName}`, {
            state: "executing",
            nextStep: "Review tool result",
          })
          yield timelineAutomation(
            automation,
            `Started ${event.toolName}`,
            "running",
            JSON.stringify(redactAutomationPayload(event.args)),
          )
          yield {
            type: "agent_tool_call",
            tool: event.toolName,
            args: event.args as Record<string, unknown>,
          }
          if (guard.break) {
            yield timelineAutomation(automation, guard.reason, "failed")
            yield closeAutomation(guard.reason, true)
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "tool-result":
          yield timelineAutomation(
            automation,
            `Finished ${event.toolName}`,
            "done",
            JSON.stringify(redactAutomationPayload(event.result)),
          )
          yield { type: "agent_tool_result", tool: event.toolName, result: event.result }
          break
        case "step-finish": {
          stepCount++
          yield stepAutomation(automation, `Agent step ${stepCount}`, {
            state: "executing",
            step: stepCount,
            maxSteps: MAX_STEPS,
          })
          yield { type: "agent_step", iteration: stepCount, max: MAX_STEPS }
          const guard = guards.onStep()
          if (guard.break) {
            yield timelineAutomation(automation, guard.reason, "failed")
            yield closeAutomation(guard.reason, true)
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "error":
          yield closeAutomation(
            event.error instanceof Error ? event.error.message : String(event.error),
            true,
          )
          yield {
            type: "error",
            message: event.error instanceof Error ? event.error.message : String(event.error),
          }
          return
      }
    }

    const summary = textTail.replace(/\n/g, " ").trim() || "agent task complete"
    await activeHooks.onStop(summary)
    if (memoryEnabled(req.plan)) {
      await writeTurn({ kind: "agent", input: req.text, output: summary, summary })
      // Fire compaction after each agent run; it no-ops if the session log is too short.
      compact().catch((err) => console.warn("[yomi/agent] compaction error:", err))
    }
    yield timelineAutomation(automation, summary, "done")
    yield closeAutomation(summary)
    yield { type: "done" }
  } finally {
    if (!automationClosed && !signal?.aborted) {
      opts?.emit?.(failAutomation(automation, "Automation ended before completion."))
    }
    // Always detach the act emitter so a later run doesn't write to a dead stream.
    if (opts?.emit) setActEmitter(null)
  }
}
