// Act-mode safety guard (Spec 16). Two jobs: refuse blocklisted apps outright, and flag
// destructive/irreversible actions so they require confirmation before running.

// Per-app blocklist (privacy non-negotiable): never enumerate or act on these.
const BLOCKED_APPS = [
  /1password/i,
  /bitwarden/i,
  /keepass/i,
  /lastpass/i,
  /dashlane/i,
  /nordpass/i,
  /\bbank\b/i,
  /banking/i,
  /chase/i,
  /wells fargo/i,
  /citibank/i,
  /barclays/i,
  /hsbc/i,
]

// Destructive verbs on a control label/name → irreversible enough to confirm first.
const RISKY_LABEL =
  /\b(delete|remove|discard|erase|wipe|destroy|send|pay|buy|purchase|checkout|submit|format|uninstall|deactivate|reset)\b/i
const CLOSE_WITHOUT_SAVE = /close without saving|don'?t save|do not save/i

export function isBlockedApp(windowTitle: string): boolean {
  return BLOCKED_APPS.some((re) => re.test(windowTitle))
}

// Same blocklist applied to a URL's hostname — used by the browser MCP guard (Spec 17).
export function isBlockedDomain(url: string): boolean {
  try {
    return BLOCKED_APPS.some((re) => re.test(new URL(url).hostname))
  } catch {
    return false
  }
}

// Does a control label / typed text read as a destructive, irreversible action?
export function isDestructiveText(text: string): boolean {
  return RISKY_LABEL.test(text) || CLOSE_WITHOUT_SAVE.test(text)
}

// Heuristic risk classifier for a proposed action against a target element.
export function classifyRisk(
  kind: "invoke" | "set_value" | "toggle" | "click_point",
  el?: { name?: string; role?: string },
): { risky: boolean; reason?: string } {
  const name = el?.name ?? ""
  if (isDestructiveText(name)) {
    return { risky: true, reason: `"${name}" looks destructive` }
  }
  // Typing into a password field is sensitive even if the label isn't a "verb".
  if (kind === "set_value" && /password|passcode|pin/i.test(name)) {
    return { risky: true, reason: "target looks like a password field" }
  }
  return { risky: false }
}

// Confirmation channel. Desktop (Spec 16 step 5) registers a handler that does the voice
// "yes/no" round-trip. Until one is registered, risky actions are blocked unless the
// YOMI_ACT_AUTOCONFIRM escape hatch is set (used by tests / headless runs).
type Confirmer = (label: string, reason: string) => Promise<boolean>
let confirmer: Confirmer | null = null

export function registerConfirmer(fn: Confirmer | null): void {
  confirmer = fn
}

export async function confirmRisky(label: string, reason: string): Promise<boolean> {
  if (process.env.YOMI_ACT_AUTOCONFIRM === "true") return true
  if (confirmer) return confirmer(label, reason)
  return false
}
