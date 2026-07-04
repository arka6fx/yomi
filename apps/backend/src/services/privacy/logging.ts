const LINKING_TOKEN_RE = /token=([a-zA-Z0-9_-]+)/g
const USER_ID_RE = /user(?:Id|_id)?=([a-zA-Z0-9_-]{8,})/g
const CHAT_ID_RE = /chat(?:Id|_id)?=([a-zA-Z0-9_-]+)/g
const MESSAGE_TEXT_RE = /text="[^"]{0,80}"/g
const TRANSCRIPT_RE = /transcript: "([^"]+)"/g
const CODE_RE = /code=([a-zA-Z0-9_-]{4,})/g
const DODO_SUB_RE = /(dodo_subscriptionId|subscriptionId|dodoSubscriptionId)=([a-zA-Z0-9_-]+)/g
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function redactLine(line: string): string {
  return line
    .replace(LINKING_TOKEN_RE, "token=[REDACTED]")
    .replace(USER_ID_RE, (match) => {
      const eqIdx = match.indexOf("=")
      return match.slice(0, eqIdx + 1) + "[REDACTED]"
    })
    .replace(CHAT_ID_RE, (match) => {
      const eqIdx = match.indexOf("=")
      return match.slice(0, eqIdx + 1) + "[REDACTED]"
    })
    .replace(MESSAGE_TEXT_RE, 'text="[REDACTED]"')
    .replace(TRANSCRIPT_RE, 'transcript: "[REDACTED]"')
    .replace(CODE_RE, "code=[REDACTED]")
    .replace(DODO_SUB_RE, (match) => {
      const eqIdx = match.indexOf("=")
      return match.slice(0, eqIdx + 1) + "[REDACTED]"
    })
    .replace(EMAIL_RE, "[EMAIL REDACTED]")
}

export function redactConsole(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string") return redactLine(arg)
    return arg
  })
}

const originalConsole = {
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  log: console.log.bind(console),
}

console.warn = (...args: unknown[]) => originalConsole.warn(...redactConsole(args))
console.error = (...args: unknown[]) => originalConsole.error(...redactConsole(args))
console.log = (...args: unknown[]) => originalConsole.log(...redactConsole(args))
