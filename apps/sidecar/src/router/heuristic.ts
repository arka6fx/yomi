import type { IntentClassification, RouterInput } from "@yomi/shared"

const FAST_QUESTION_WORDS = /^(what|how|why|when|where|who|which)\b/i
const FAST_VERBS = /\b(translate|summaris[e]?|summariz[e]?|explain|define|read)\b/i
const AGENT_TRIGGER = /^yomi[, ]+agent[, ]?/i
const AGENT_VERBS =
  /\b(research|draft|send|schedule|book|create|open|file|download|install|deploy|commit|push|email|dm|message)\b/i
const AGENT_CONNECTIVES = /\band then\b|\bafter that\b|\bfinally\b|\bthen /i

export function scoreHeuristic(input: RouterInput): IntentClassification {
  const text = input.text.trim()
  const wordCount = text.split(/\s+/).length

  // Explicit trigger is unambiguous — short-circuit before scoring
  if (AGENT_TRIGGER.test(text)) {
    return { path: "agent", confidence: 0.95, reason: "explicit trigger", source: "heuristic" }
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
