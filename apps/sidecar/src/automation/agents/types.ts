import type { ProviderId, UiaPort } from "../providers/types.js"

// A SubAgent is a domain persona routed within the single Execution node: it scopes the tool subset,
// nudges the system prompt, and supplies a real validate(). It is NOT a separate graph — the graph
// topology is unchanged. Agent ids reuse the owner ids from classifyAutomationOwner.
export type ValidationVerdict = "pass" | "fail" | "inconclusive"

export interface ValidateContext {
  goal: string
  lastError: string | null
  uia: UiaPort
}

export interface SubAgent {
  id: string
  label: string
  provider: ProviderId
  // Exact tool keys this agent may use. Omit to inherit the FULL merged tool set (the safe default
  // that protects existing flows like WhatsApp/Notepad from accidental scoping regressions).
  toolNames?: string[]
  // Name-prefix matches, for dynamically-named tools (e.g. Playwright "browser_*").
  toolPrefixes?: string[]
  // Appended to the turn's system prompt to focus the agent on its domain.
  systemHint: string
  // Confirm the outcome. Tri-state on purpose: only return "fail" on POSITIVE evidence of failure,
  // otherwise "inconclusive" so the Validation node falls back to the generic rubric (no regression).
  validate(ctx: ValidateContext): Promise<ValidationVerdict>
}

// Read-only context/recall tools every scoped agent keeps regardless of domain.
export const BASE_TOOLS = ["look_at_screen", "read_file", "search"]
