export type UsageCreditKind =
  "chat" | "voice" | "analyze" | "bot_message" | "agent" | "composio_tool"

export type BillableUsageKind = UsageCreditKind

export type UsagePricingInput = {
  durationSeconds?: number
  // Number of billed units for per-unit kinds (Composio tool calls in a turn).
  units?: number
  model?: string
  inputTokens?: number
  outputTokens?: number
}

// Flat cost per interaction TYPE, tiered by real cost. A fast chat/image answer
// is one LLM call; an agent run (a Telegram message) does
// multi-step tool work, so it costs more. `composio_tool` is charged PER CALL and
// multiplied by the number of calls in the turn. Tune from ai_usage_events telemetry.
const CREDIT_COSTS: Record<UsageCreditKind, number> = {
  chat: 1,
  voice: 2,
  analyze: 1,
  bot_message: 3,
  agent: 3,
  composio_tool: 1,
}

function creditCost(kind: UsageCreditKind, units = 1): number {
  return CREDIT_COSTS[kind] * Math.max(Math.ceil(units), 1)
}

export function creditsForUsage(kind: BillableUsageKind, input: UsagePricingInput = {}): number {
  if (kind === "voice") {
    const minutes = Math.max(Math.ceil((input.durationSeconds ?? 60) / 60), 1)
    return creditCost(kind, minutes)
  }

  if (kind === "composio_tool") {
    return creditCost(kind, input.units ?? 1)
  }

  return creditCost(kind)
}
