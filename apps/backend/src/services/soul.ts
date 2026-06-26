import { eq } from "drizzle-orm"
import { db } from "@yomi/db"
import * as authSchema from "../auth-schema.js"

// First-contact personality ("soul") onboarding for off-device platforms (Telegram).
// The desktop sidecar has its own in-memory flow; the backend is multi-user and runs on
// stateless Worker isolates, so the state must live in the DB (on the user row).

export type SoulOnboardingState = "unprompted" | "awaiting" | "done"

export const ASK_SOUL_MESSAGE =
  "Hey, I'm Yomi. Before we get going, do you want to define my personality and working style? " +
  'Reply with a short style guide, or say "default" and I\'ll use my built-in style.'

const MAX_SOUL_LENGTH = 2000
const MIN_SOUL_LENGTH = 10

function wantsDefault(text: string): boolean {
  return /^(default|skip|no|nope|use default|use the default|built ?in|built-in)$/i.test(text.trim())
}

// Pure state machine. Given the current state and the incoming message text, decide the
// reply to send and the next persisted state. `reply: null` means onboarding is complete
// (or already complete) and the message should be handled normally by the agent.
export type SoulDecision =
  | { reply: null } // proceed to normal handling
  | { reply: string; next: SoulOnboardingState; agentSoul?: string | null }

export function decideSoulOnboarding(state: SoulOnboardingState, text: string): SoulDecision {
  if (state === "done") return { reply: null }

  if (state === "unprompted") {
    // Ask on first contact; do not consume their first message as an answer.
    return { reply: ASK_SOUL_MESSAGE, next: "awaiting" }
  }

  // state === "awaiting": interpret this message as the answer.
  const trimmed = text.trim()

  if (wantsDefault(trimmed)) {
    return {
      reply: "Got it, I'll use my default style: sharp, warm, and practical. What can I help you with?",
      next: "done",
      agentSoul: null,
    }
  }

  if (trimmed.length >= MIN_SOUL_LENGTH) {
    return {
      reply: "Perfect, I'll keep that as my working style. What can I help you with?",
      next: "done",
      agentSoul: trimmed.slice(0, MAX_SOUL_LENGTH),
    }
  }

  // Too short / empty to be a usable style guide — ask again, stay awaiting.
  return { reply: ASK_SOUL_MESSAGE, next: "awaiting" }
}

async function getSoulOnboardingState(userId: string): Promise<SoulOnboardingState> {
  const [row] = await db
    .select({ state: authSchema.user.soulOnboarding })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return (row?.state as SoulOnboardingState | undefined) ?? "unprompted"
}

// Returns the user's custom soul, or null to use the built-in default.
export async function getUserSoul(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ soul: authSchema.user.agentSoul })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return row?.soul ?? null
}

// Drives one onboarding step for an incoming off-device message. Reads the persisted
// state, applies the pure decision, persists any change, and returns the reply to send
// (or null when the message should proceed to the normal agent path). Onboarding turns
// never reach the agent, so they are free (no credit charge).
export async function advanceSoulOnboarding(userId: string, text: string): Promise<string | null> {
  const state = await getSoulOnboardingState(userId)
  const decision = decideSoulOnboarding(state, text)
  if (decision.reply === null) return null

  const patch: Partial<typeof authSchema.user.$inferInsert> = {
    soulOnboarding: decision.next,
    updatedAt: new Date(),
  }
  if ("agentSoul" in decision) patch.agentSoul = decision.agentSoul ?? null
  await db.update(authSchema.user).set(patch).where(eq(authSchema.user.id, userId))

  return decision.reply
}
