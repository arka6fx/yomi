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
  // "get_ui_tree",
  // "invoke_element",
  // "click_element",
  // "set_value",
  // "type_text",
  // "toggle_element",
  // "press_key",
  // "adjust_volume",
  // "adjust_spotify_volume",
  // "control_spotify",
  // "play_spotify",
  // "launch_app",
  // "point_cursor",
  // "click",
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
  read_file: "Read a file from the notepad (~/.yomi/)",
  write_file: "Write content to a file in the notepad (~/.yomi/)",
  list_files: "List files in the notepad directory",
  search: "Full-text search across notepad files using ripgrep",
  // get_ui_tree: "List interactive controls of the foreground window via UI Automation",
  // invoke_element: "Invoke (click/activate) a control by its UI Automation ref",
  // click_element: "Real mouse click on a control by ref (use for UWP apps where invoke fails)",
  // set_value: "Set the text value of an editable control by its ref",
  // type_text: "Type literal text via real keystrokes (use when set_value doesn't react)",
  // toggle_element: "Toggle a checkbox/switch control by its ref",
  // press_key: "Press a key or chord (Enter, Tab, Ctrl+S) in the foreground app",
  // adjust_volume: "Increase, decrease, or mute the system volume",
  // adjust_spotify_volume: "Increase, decrease, or mute Spotify's own in-app volume",
  // control_spotify: "Control Spotify playback (pause/resume/next/previous/stop) via media keys",
  // play_spotify: "Open Spotify, search for a track/artist, and click the best visible Play button",
  // launch_app: "Open a desktop app by name, then read its controls",
  // point_cursor: "Move the mouse cursor to a screen position (coordinate fallback)",
  // click: "Click the mouse at the last pointed position (coordinate fallback)",
  cronjob: "Create, list, view, update, delete, pause, or resume scheduled cron jobs",
  send_message: "Send a message to a connected messaging platform (Telegram, Discord)",
  list_platforms: "List connected messaging platforms and active gateway sessions",
}

// Re-export for consumers that need the actual AI SDK tool objects.
export { createAgentTools } from "../tools/index.js"
