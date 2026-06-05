import type { SubAgent } from "./types.js"

// Browser agent: scoped to the Playwright MCP tools (dynamic "browser_*" names) plus screen reads.
// validate() stays inconclusive for now — page-state assertions arrive in a later iteration.
export const browserAgent: SubAgent = {
  id: "browser",
  label: "Browser Agent",
  provider: "browser",
  toolPrefixes: ["browser_"],
  toolNames: ["look_at_screen", "web_search", "fetch_url"],
  systemHint:
    "You are the browser agent. Prefer the browser_* automation tools to navigate and act on pages. " +
    "Snapshot the page to ground each action before clicking or typing.",
  validate: async () => "inconclusive",
}
