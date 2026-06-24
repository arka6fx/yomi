// Canonical tool registry for the harness.
// Fast-path tools are called directly (not via SDK tool-use).
// Agent-path tools are wired through tools/index.ts + applyHooks in agent.ts.

export const FAST_TOOLS = ["look_at_screen", "speak"] as const
export const AGENT_TOOLS = [
  "look_at_screen",
  "bash",
  "web_search",
  "fetch_url",
  "cronjob",
  "send_message",
  "list_platforms",
] as const

export type FastToolName = (typeof FAST_TOOLS)[number]
export type AgentToolName = (typeof AGENT_TOOLS)[number]

// Single source of truth for tool descriptions referenced in the system prompt.
export const TOOL_DESCRIPTIONS: Record<FastToolName | AgentToolName, string> = {
  look_at_screen: "Capture a screenshot of the user's current screen",
  speak: "Speak a response aloud to the user via TTS",
  bash: "Run a shell command (sandboxed; denylist enforced)",
  web_search: "Search the web — returns titles, URLs, and snippets",
  fetch_url: "Fetch the text content of a URL",
  cronjob: "Create, list, view, update, delete, pause, or resume scheduled cron jobs",
  send_message: "Send a message to a connected messaging platform (Telegram)",
  list_platforms: "List connected messaging platforms and active gateway sessions",
}

// Re-export for consumers that need the actual AI SDK tool objects.
export { createAgentTools } from "../tools/index.js"
