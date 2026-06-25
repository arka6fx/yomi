import type { IntentClassification, RouterInput } from "@yomi/shared"

const FAST_QUESTION_WORDS = /^(what|how|why|when|where|who|which)\b/i
const FAST_VERBS = /\b(translate|summaris[e]?|summariz[e]?|explain|define|read)\b/i
const AGENT_TRIGGER = /^yomi[, ]+agent[, ]?/i
const AGENT_VERBS =
  /\b(research|draft|send|schedule|book|create|open|file|download|install|deploy|commit|push|email|dm|message)\b/i
const AGENT_CONNECTIVES = /\band then\b|\bafter that\b|\bfinally\b|\bthen /i
const WINDOWS_NOTEPAD_ACTION =
  /\b(?:write|wright|type|put|draft|save|store|note)\b.*\b(?:the\s+)?(?:windows\s+)?notepad\b/i
// Connector-related queries must reach the agent path so connector tools are available
const CONNECTOR_QUERY =
  /\b(email|gmail|inbox|calendar|event|meeting|github|pr|pull.?request|issue|notion|slack|linear|drive|channel|todo|task|repo|repository)\b/i

export function scoreHeuristic(input: RouterInput): IntentClassification {
  const text = input.text.trim()
  const wordCount = text.split(/\s+/).length

  // Explicit trigger is unambiguous — short-circuit before scoring
  if (AGENT_TRIGGER.test(text)) {
    return { path: "agent", confidence: 0.95, reason: "explicit trigger", source: "heuristic" }
  }

  // Connector queries (Notion, Drive, Gmail, GitHub, etc.) must reach the agent path
  // because the fast pipeline has zero tools. Short-circuit before scoring so that even
  // simple questions like "what's in my Notion?" don't get classified as fast.
  if (CONNECTOR_QUERY.test(text)) {
    return { path: "agent", confidence: 0.85, reason: "connector query", source: "heuristic" }
  }

  let fastScore = 0
  const fastReasons: string[] = []
  let agentScore = 0
  const agentReasons: string[] = []

  if (FAST_QUESTION_WORDS.test(text)) {
    fastScore += 0.3
    fastReasons.push("question word")
  }
  if (wordCount <= 12) {
    fastScore += 0.3
    fastReasons.push("short request")
  }
  if (FAST_VERBS.test(text)) {
    fastScore += 0.3
    fastReasons.push("fast verb")
  }

  if (AGENT_VERBS.test(text)) {
    agentScore += 0.4
    agentReasons.push("action verb")
  }
  if (WINDOWS_NOTEPAD_ACTION.test(text)) {
    agentScore += 0.7
    agentReasons.push("windows notepad action")
  }
  if (AGENT_CONNECTIVES.test(text)) {
    agentScore += 0.4
    agentReasons.push("multi-step connective")
  }
  if (wordCount > 30) {
    agentScore += 0.4
    agentReasons.push("long request")
  }

  const path = agentScore > fastScore ? "agent" : "fast"
  const rawConf = path === "agent" ? agentScore : fastScore
  // 0.5 when nothing fires (default to fast per invariant)
  const confidence = rawConf > 0 ? Math.min(rawConf, 1) : 0.5
  const reason =
    (path === "agent" ? agentReasons : fastReasons).join(", ") || "no signals, defaulting to fast"

  return { path, confidence, reason, source: "heuristic" }
}
