import { globalShortcut, app } from "electron"

export type HotkeyState = "idle" | "listening" | "processing" | "text-input"

let state: HotkeyState = "idle"
let enabled = false      // Gated by auth — false while signed out
let initialized = false  // Shortcuts registered once at first auth

let onStateChange: ((s: HotkeyState) => void) | null = null
let onListenStop: (() => void) | null = null
let onTextQuery: (() => void) | null = null
let onAbort: (() => void) | null = null
let onAnyEscape: (() => void) | null = null  // fired on every ESC, regardless of state

// Called once after first successful auth. Safe to call again on re-auth —
// subsequent calls update the callbacks and re-enable without re-registering shortcuts.
export function initHotkey(opts: {
  onStateChange: (s: HotkeyState) => void
  onListenStop: () => void
  onTextQuery: () => void
  onAbort: () => void
  onAnyEscape?: () => void
}): void {
  onStateChange = opts.onStateChange
  onListenStop  = opts.onListenStop
  onTextQuery   = opts.onTextQuery
  onAbort       = opts.onAbort
  onAnyEscape   = opts.onAnyEscape ?? null

  if (!initialized) {
    initialized = true

    // Ctrl+Shift+Space — voice recording toggle
    globalShortcut.register("Ctrl+Shift+Space", () => {
      if (!enabled) return
      if (state === "idle") {
        transition("listening")
      } else if (state === "listening") {
        transition("processing")
        onListenStop?.()
      }
    })

    // Ctrl+Shift+Enter — open text input
    globalShortcut.register("Ctrl+Shift+Return", () => {
      if (!enabled) return
      if (state === "idle") {
        transition("text-input")
        onTextQuery?.()
      }
    })

    // Escape — cancel listening/text-input; abort stream if processing.
    // globalShortcut.register("Escape") can fail silently on some Windows setups;
    // triggerEscape() below provides an IPC fallback for when the window is focused.
    const escOk = globalShortcut.register("Escape", () => triggerEscape())
    if (!escOk) console.warn("[yomi/hotkey] Escape global shortcut failed to register — IPC fallback active")

    app.on("will-quit", () => globalShortcut.unregisterAll())
  }

  enabled = true
}

// Re-enable shortcuts after sign-in without changing callbacks.
export function enableHotkeys(): void {
  enabled = true
}

// Disable all AI shortcuts immediately (called on sign-out).
export function disableHotkeys(): void {
  enabled = false
  if (state !== "idle") transition("idle")
}

// IPC fallback for when globalShortcut("Escape") fails to register.
// Called directly by the main-process IPC handler when the renderer sends yomi:escape.
export function triggerEscape(): void {
  onAnyEscape?.()  // always fires — stops TTS even when state is idle
  if (!enabled) return
  if (state === "listening" || state === "text-input") {
    transition("idle")
  } else if (state === "processing") {
    onAbort?.()
    transition("idle")
  }
}

// Called by ipc.ts when a pipeline finishes or errors.
export function resetToIdle(): void {
  transition("idle")
}

// Called by ipc.ts when a text query is submitted and processing begins.
export function activateProcessing(): void {
  transition("processing")
}

function transition(next: HotkeyState): void {
  const prev = state
  state = next

  // Register Enter as an alternative stop-recording key only while listening,
  // so it never captures Enter globally during normal app usage.
  if (next === "listening") {
    globalShortcut.register("Return", () => {
      if (!enabled || state !== "listening") return
      transition("processing")
      onListenStop?.()
    })
  } else if (prev === "listening") {
    globalShortcut.unregister("Return")
  }

  onStateChange?.(next)
}
