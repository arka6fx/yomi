export type UsageCreditKind = "chat" | "voice" | "analyze" | "bot_message"

export type BillableUsageKind = UsageCreditKind

export type UsagePricingInput = {
  durationSeconds?: number
  model?: string
  inputTokens?: number
  outputTokens?: number
}

const CREDIT_COSTS: Record<UsageCreditKind, number> = {
  chat: 1,
  voice: 2,
  analyze: 1,
  bot_message: 1,
}

function creditCost(kind: UsageCreditKind, units = 1): number {
  return CREDIT_COSTS[kind] * Math.max(Math.ceil(units), 1)
}

export function creditsForUsage(kind: BillableUsageKind, input: UsagePricingInput = {}): number {
  if (kind === "voice") {
    const minutes = Math.max(Math.ceil((input.durationSeconds ?? 60) / 60), 1)
    return creditCost(kind, minutes)
  }

  return creditCost(kind)
}
