// Pattern-based error taxonomy for the execution → recovery pipeline.
// Recovery branches on ErrorClass to apply the right strategy instead of
// treating every failure identically.

export type ErrorClass =
  | "context_overflow"
  | "rate_limit"
  | "content_policy"
  | "auth"
  | "timeout"
  | "tool_failure"
  | "unknown"

const PATTERNS: Array<[ErrorClass, RegExp]> = [
  ["context_overflow", /context.{0,30}(length|window|overflow|limit|exceed|too.long|maximum)/i],
  ["context_overflow", /maximum\s+(context|token|sequence)/i],
  ["context_overflow", /reduce\s+(your\s+)?input/i],
  ["rate_limit", /429|rate.?limit|too.many.requests|quota.?exceeded|requests.per/i],
  ["content_policy", /content.?(policy|filter|violation|moderation)|safety.filter|harmful/i],
  ["content_policy", /403|forbidden/i],
  ["auth", /401|unauthorized|authentication.?fail|invalid.?(api.?key|token|credential)/i],
  ["timeout", /timeout|timed.?out|ETIMEDOUT|ECONNRESET|socket.hang.up/i],
  ["tool_failure", /^tool\s+\S+\s+failed/i],
]

export function classifyError(err: unknown): ErrorClass {
  const msg = err instanceof Error ? err.message : String(err ?? "")
  for (const [cls, re] of PATTERNS) {
    if (re.test(msg)) return cls
  }
  return "unknown"
}
