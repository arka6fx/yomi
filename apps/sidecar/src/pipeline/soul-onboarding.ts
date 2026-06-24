let asked = Boolean(process.env["YOMI_AGENT_SOUL"]?.trim())
let awaitingAnswer = false

const ASK_SOUL_MESSAGE =
  "Before we continue, do you want to define my personality and working style? Reply with a short style guide, or say \"default\" and I'll use Yomi's built-in style."

function disabled(): boolean {
  return process.env["YOMI_DISABLE_SOUL_ONBOARDING"] === "1" || process.argv.some((arg) => arg === "test" || /\.test\.[cm]?tsx?$/.test(arg))
}

function wantsDefault(text: string): boolean {
  return /^(default|skip|no|nope|use default|use the default|built in|built-in)$/i.test(text.trim())
}

export function maybeHandleSoulOnboarding(text: string): string | null {
  if (disabled()) return null
  if (process.env["YOMI_AGENT_SOUL"]?.trim()) return null

  if (!asked) {
    asked = true
    awaitingAnswer = true
    return ASK_SOUL_MESSAGE
  }

  if (!awaitingAnswer) return null
  awaitingAnswer = false

  if (wantsDefault(text)) {
    return "I'll use the default Yomi style: sharp, warm, practical, and direct. What would you like to do next?"
  }

  const customSoul = text.trim().slice(0, 2000)
  if (customSoul.length >= 10) {
    process.env["YOMI_AGENT_SOUL"] = customSoul
    return "I'll use that as my working style for this session. What would you like to do next?"
  }

  return ASK_SOUL_MESSAGE
}

export function __resetSoulOnboardingForTest(): void {
  asked = Boolean(process.env["YOMI_AGENT_SOUL"]?.trim())
  awaitingAnswer = false
}
