import { tool } from "ai"
import { z } from "zod"

// Curated subset of Telegram's fixed message-reaction emoji allowlist
// (https://core.telegram.org/bots/api#reactiontypeemoji) — Telegram rejects
// any emoji outside its allowlist, so this stays a hand-picked, verified
// subset rather than free text.
export const ALLOWED_REACTIONS = [
  "👍",
  "👎",
  "❤️",
  "🔥",
  "🎉",
  "😁",
  "😢",
  "🤔",
  "🙏",
  "💯",
  "😍",
  "🤯",
  "👏",
] as const

export type ReactFn = (emoji: string) => Promise<void>

export function createReactionTool(react: ReactFn) {
  return tool({
    description:
      "React to the user's message with an emoji, IN ADDITION to your text reply. " +
      "Use this rarely — only when a reaction genuinely fits (a clear win, a thanks, a " +
      "funny moment, a strong yes/no). Most turns should not use this tool at all.",
    parameters: z.object({
      emoji: z.enum(ALLOWED_REACTIONS).describe("One emoji from the allowed reaction set"),
    }),
    execute: async ({ emoji }) => {
      await react(emoji)
      return { ok: true }
    },
  })
}
