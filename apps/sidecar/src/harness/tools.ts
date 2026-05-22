// Canonical tool registry for the harness.
// Fast-path tools are called directly (not via SDK tool-use).
// Agent-path tools are wired through tools/index.ts + applyHooks in agent.ts.

export const FAST_TOOLS = ["look_at_screen", "speak"] as const
export const AGENT_TOOLS = [
  "look_at_screen",
  "bash",
  "web_search",
  "fetch_url",
  "read_file",
  "write_file",
  "list_files",
  "search",
  "point_cursor",
  "click",
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
  read_file: "Read a file from the notepad (~/.yomi/)",
  write_file: "Write content to a file in the notepad (~/.yomi/)",
  list_files: "List files in the notepad directory",
  search: "Full-text search across notepad files using ripgrep",
  point_cursor: "Move the mouse cursor to a screen position",
  click: "Click the mouse at the current cursor position",
}

// Re-export for consumers that need the actual AI SDK tool objects.
export { createAgentTools } from "../tools/index.js"
