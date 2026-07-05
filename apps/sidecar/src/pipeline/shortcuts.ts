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

// ── Messaging shortcuts ─────────────────────────────────────────────────────

export function normalizeSpokenRecipient(raw: string): string {
  return raw
    .trim()
    .replace(/^(my|to)\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim()
}

export function reminderDraftRequest(text: string): { message: string } | null {
  const t = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim()
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
  const directMatch = t.match(/^(?:(?:a\s+)?message\s+)?(.+?)\s+(?:saying|that|to say)\s+(.+)$/i)
  if (directMatch) return { recipient: directMatch[1]!.trim(), message: directMatch[2]!.trim() }
  return null
}

export function pendingDraftRecipientRequest(text: string, hasDraft: boolean): string | null {
  if (!hasDraft) return null
  const t = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim()
  const match = t.match(/^(?:send|text|message)\s+(?:it|that|this)\s+(?:to|for)\s+(.+)$/i)
  if (match) return match[1]!.trim()
  const nameMatch = t.match(/^(?:send|text|message)\s+(.+)$/i)
  if (nameMatch && nameMatch[1]!.trim().length < 40) return nameMatch[1]!.trim()
  return null
}
