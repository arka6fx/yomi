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
  if (
    /^(?:resume|unpause|continue)$/.test(t) ||
    (musicCtx && /\b(resume|unpause|continue)\b/.test(t))
  )
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

// ── Messaging shortcuts ─────────────────────────────────────────────────────

export function normalizeSpokenRecipient(raw: string): string {
  return raw.trim().replace(/^(my|to)\s+/i, "").replace(/^["']|["']$/g, "").trim()
}

export function reminderDraftRequest(text: string): { message: string } | null {
  const t = text.toLowerCase().replace(/[.!?]+$/g, "").trim()
  const remindMatch = t.match(
    /\b(?:remind|reminder|remind me|set a reminder|create a reminder|make a reminder)\s+(?:to\s+)?(.+)$/i,
  )
  if (remindMatch) return { message: remindMatch[1]!.trim() }
  return null
}

export function whatsAppMessageRequest(
  text: string,
): { recipient: string; message: string } | null {
  const t = text
    .toLowerCase()
    .replace(/\b(?:via|on|through|using)\s+(?:whatsapp|telegram|message)\b/gi, "")
    .replace(/\b(?:send|text)\s+/gi, "")
    .trim()
  const toMatch = t.match(
    /^(?:(?:a\s+)?message\s+)?(?:to|for)\s+(.+?)\s+(?:saying|that|to say)\s+(.+)$/i,
  )
  if (toMatch) return { recipient: toMatch[1]!.trim(), message: toMatch[2]!.trim() }
  const directMatch = t.match(
    /^(?:(?:a\s+)?message\s+)?(.+?)\s+(?:saying|that|to say)\s+(.+)$/i,
  )
  if (directMatch) return { recipient: directMatch[1]!.trim(), message: directMatch[2]!.trim() }
  return null
}

export function pendingDraftRecipientRequest(text: string, hasDraft: boolean): string | null {
  if (!hasDraft) return null
  const t = text.toLowerCase().replace(/[.!?]+$/g, "").trim()
  const match = t.match(
    /^(?:send|text|message)\s+(?:it|that|this)\s+(?:to|for)\s+(.+)$/i,
  )
  if (match) return match[1]!.trim()
  const nameMatch = t.match(/^(?:send|text|message)\s+(.+)$/i)
  if (nameMatch && nameMatch[1]!.trim().length < 40) return nameMatch[1]!.trim()
  return null
}
