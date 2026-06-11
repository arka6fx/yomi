import type { ToolSet } from "ai"
import { classifyAutomationOwner } from "../runs.js"
import { BASE_TOOLS, type SubAgent } from "./types.js"
import { spotifyAgent } from "./spotify.js"
// import { browserAgent } from "./browser.js"

// Domains that intentionally inherit the FULL merged tool set (no scoping). These flows (WhatsApp,
// Notepad, calendar, research) are already well-tuned and must not regress; they only gain a system
// hint + the modular registry slot. validate() stays inconclusive → existing rubric applies.
function inheritAll(id: string, label: string, hint: string): SubAgent {
  return { id, label, provider: "native", systemHint: hint, validate: async () => "inconclusive" }
}

const messagingAgent = inheritAll(
  "messaging",
  "Messaging Agent",
  "You are the messaging agent. Sending a message always requires explicit user approval first.",
)
const calendarAgent = inheritAll(
  "calendar",
  "Calendar Agent",
  "You are the calendar agent. Confirm the event details before creating or modifying anything.",
)
const windowsAgent = inheritAll(
  "windows",
  "Windows Agent",
  "You are the Windows agent. Use UIA tools to drive native apps; verify the result on screen.",
)
const researchAgent = inheritAll(
  "research",
  "Research Agent",
  "You are the research agent. Gather, cross-check, and summarize concisely from the web.",
)
const generalAgent = inheritAll(
  "automation",
  "Automation Agent",
  "You are a general automation agent. Choose the most direct tool for the task and verify success.",
)

const byId: Record<string, SubAgent> = {
  spotify: spotifyAgent,
  // browser: browserAgent, // will provide later
  messaging: messagingAgent,
  calendar: calendarAgent,
  windows: windowsAgent,
  research: researchAgent,
  automation: generalAgent,
}

// Pick the sub-agent for a goal, reusing the existing owner classification. Unknown ids fall back to
// the general agent but keep the classified label so the Island still names the right persona.
export function resolveAgent(goal: string): SubAgent {
  const owner = classifyAutomationOwner(goal)
  const agent = byId[owner.id]
  if (agent) return agent
  return { ...generalAgent, id: owner.id, label: owner.label }
}

// Scope a merged tool set to an agent's allowance. Agents with no toolNames/toolPrefixes inherit the
// full set unchanged. Scoped agents always keep the read-only base tools (screen + memory recall).
export function scopeTools(all: ToolSet, agent: SubAgent): ToolSet {
  if (!agent.toolNames && !agent.toolPrefixes) return all
  const allowExact = new Set<string>([...BASE_TOOLS, ...(agent.toolNames ?? [])])
  const prefixes = agent.toolPrefixes ?? []
  const scoped: ToolSet = {}
  for (const [name, t] of Object.entries(all)) {
    if (allowExact.has(name) || prefixes.some((p) => name.startsWith(p))) scoped[name] = t
  }
  return scoped
}
