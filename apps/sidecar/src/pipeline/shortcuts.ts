import type { SpotifyControl, VolumeDirection } from "../tools/system.js"

const DETACHED_PHRASE_PATTERNS: RegExp[] = [
  /\bin\s+the\s+background\b/gi,
  /\bin\s+bg\b/gi,
  /\bbehind\s+the\s+scenes\b/gi,
  /\bwithout\s+switching\b/gi,
  /\bwithout\s+interrupting(?:\s+me)?\b/gi,
  /\bwhile\s+i\s+(?:keep|am)\s+working\b/gi,
  /\bdon'?t\s+switch\s+away\b/gi,
  /\bquietly\b/gi,
]

export function stripDetachedPhrases(text: string): string {
  let out = text
  for (const re of DETACHED_PHRASE_PATTERNS) out = out.replace(re, " ")
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([.?!,])/g, "$1")
    .trim()
}

export function playbackControl(text: string): SpotifyControl | null {
  const t = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim()
  const musicCtx = /\b(spotify|music|song|track|playback|tune)\b/.test(t)

  if (
    /^(?:play |go to |skip to )?(?:the )?next(?: song| track| one)?$/.test(t) ||
    /\bnext (?:song|track)\b/.test(t) ||
    /\bskip(?: this)?(?: song| track)?$/.test(t) ||
    (musicCtx && /\b(next|skip)\b/.test(t))
  )
    return "next"

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

export function spotifyPlaybackQuery(text: string): string | null {
  if (!/\bplay\b/i.test(text)) return null
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

export function volumeAction(
  text: string,
): { direction: VolumeDirection; steps: number; target: "system" | "spotify" } | null {
  const t = text.toLowerCase()
  const mentionsSound = /\b(volume|sound|audio|louder|quieter|softer|mute|unmute|inc|dec)\b/.test(t)
  if (!mentionsSound) return null
  const target = /\bspotify\b/.test(t) ? "spotify" : "system"
  const big = /\b(a lot|much|more)\b/.test(t)
  if (/\b(mute|unmute)\b/.test(t)) return { direction: "mute", steps: 1, target }
  if (/\b(increase|inc|raise|turn up|up|louder|boost)\b/.test(t))
    return { direction: "up", steps: big ? 5 : target === "spotify" ? 3 : 2, target }
  if (/\b(decrease|dec|lower|turn down|down|quieter|softer|reduce)\b/.test(t))
    return { direction: "down", steps: big ? 5 : target === "spotify" ? 3 : 2, target }
  return null
}

export function normalizeSpokenRecipient(raw: string): string {
  const trimmed = raw.replace(/^\s*(?:my|the|a|an)\s+/i, "").replace(/[.?!,]+$/g, "").trim()
  if (/^(?:me|myself|self|you|message\s*myself|send\s*to\s*myself)$/i.test(trimmed)) return "you"
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return trimmed
  const relation =
    /^(?:mom|mum|mother|mummy|ma|dad|father|papa|brother|sister|wife|husband|partner|friend)$/i
  return relation.test(parts[0] ?? "") ? parts.slice(1).join(" ") : trimmed
}

export function reminderDraftRequest(text: string): { message: string } | null {
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

  let m = cleaned.match(/\bsend\s+["']?(.+?)["']?\s+to\s+(.+)$/i)
  if (m?.[1] && m[2]) return finish(m[2], m[1])

  m = cleaned.match(
    /\b(?:text|message|msg|tell|ping|whats\s*app|whatsapp)\s+(.+?)\s+(?:saying|that|to say|:|,|-)\s+(.+)$/i,
  )
  if (m?.[1] && m[2]) return finish(m[1], m[2])

  m = cleaned.match(/\b(?:text|message|msg|whats\s*app|whatsapp)\s+(.+)$/i)
  if (m?.[1]) {
    const words = m[1].trim().split(/\s+/)
    const nameWords = /^my$/i.test(words[0] ?? "") ? 2 : 1
    if (words.length > nameWords)
      return finish(words.slice(0, nameWords).join(" "), words.slice(nameWords).join(" "))
  }
  return null
}

export function pendingDraftRecipientRequest(
  text: string,
  hasDraft: boolean,
): string | null {
  if (!hasDraft) return null
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
