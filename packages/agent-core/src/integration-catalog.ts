import { ALL_CONNECTOR_DEFS } from "./connectors/all-defs.js"
import type { ConnectorCategory } from "./connectors/connector-def.js"

export interface IntegrationSuggestion {
  id: string
  name: string
  category: ConnectorCategory
}

// Connectors excluded from nudges regardless of connection state — not
// actually connectable yet, so suggesting them would be false hope.
// swiggy: code done, blocked on Swiggy's OAuth client allowlist (issue #73
// on their manifest repo).
const NUDGE_EXCLUDED_IDS = new Set(["swiggy"])

const MAX_SUGGESTIONS = 3

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Whole-word match against any significant (>=3 char) word in the
// connector's display name — e.g. "calendar" matches "Google Calendar",
// but "example" does not match "Exa" (word-boundary regex, not substring).
function nameMatches(name: string, lowerText: string): boolean {
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  return words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(lowerText))
}

export function suggestIntegrationsFor(
  text: string,
  connectedIds: string[],
): IntegrationSuggestion[] {
  const lowerText = text.toLowerCase()
  const connected = new Set(connectedIds)
  const matches: IntegrationSuggestion[] = []

  for (const def of ALL_CONNECTOR_DEFS) {
    if (connected.has(def.id) || NUDGE_EXCLUDED_IDS.has(def.id)) continue
    if (!nameMatches(def.name, lowerText)) continue
    matches.push({ id: def.id, name: def.name, category: def.category })
    if (matches.length >= MAX_SUGGESTIONS) break
  }

  return matches
}

export function formatIntegrationSuggestions(
  suggestions: IntegrationSuggestion[],
  appUrl: string,
): string {
  if (suggestions.length === 0) return ""
  return suggestions
    .map((s) => `${s.name} (${s.category}): ${appUrl}/dashboard?connect=${s.id}`)
    .join("\n")
}
