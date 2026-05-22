import type { IntentClassification, RouterInput } from "@yomi/shared"
import { scoreHeuristic } from "./heuristic.js"
import { classifyWithLlm } from "./llm.js"

export async function classifyIntent(input: RouterInput): Promise<IntentClassification> {
  // Read fresh each call so tests (and runtime env changes) take effect immediately
  const HEURISTIC_THRESHOLD = parseFloat(process.env.ROUTER_HEURISTIC_THRESHOLD || "0.8")
  // Phase 0: LLM classifier is off by default — set ROUTER_LLM_ENABLED=true to enable
  const LLM_ENABLED = process.env.ROUTER_LLM_ENABLED === "true"

  const heuristic = scoreHeuristic(input)

  if (!LLM_ENABLED || heuristic.confidence >= HEURISTIC_THRESHOLD) {
    return heuristic
  }

  try {
    return await classifyWithLlm(input)
  } catch (err) {
    // Timeout or provider error — fall back to heuristic result
    console.warn("[yomi/router] LLM classifier failed, using heuristic:", err instanceof Error ? err.message : err)
    return heuristic
  }
}
