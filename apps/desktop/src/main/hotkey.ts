import { globalShortcut, app } from "electron"

export type HotkeyState = "idle" | "listening" | "processing" | "text-input"

let state: HotkeyState = "idle"
let onStateChange: ((s: HotkeyState) => void) | null = null
let onListenStop: (() => void) | null = null
let onTextQuery: (() => void) | null = null

// Must be called after app.whenReady() resolves
export function initHotkey(opts: {
  onStateChange: (s: HotkeyState) => void
  onListenStop: () => void
  onTextQuery: () => void
}): void {
  onStateChange  = opts.onStateChange
  onListenStop   = opts.onListenStop
  onTextQuery    = opts.onTextQuery

  // Ctrl+Shift+Space — voice recording toggle
  globalShortcut.register("Ctrl+Shift+Space", () => {
    if (state === "idle") {
      transition("listening")
    } else if (state === "listening") {
      transition("processing")
      onListenStop?.()
    }
  })

  // Ctrl+Shift+Enter — open text input (for when you can't talk)
  globalShortcut.register("Ctrl+Shift+Return", () => {
    if (state === "idle") {
      transition("text-input")
      onTextQuery?.()
    }
  })

  // Escape — cancel voice or text-input; ignore during processing
  globalShortcut.register("Escape", () => {
    if (state === "listening" || state === "text-input") transition("idle")
  })

  app.on("will-quit", () => globalShortcut.unregisterAll())
}

// Called by ipc.ts when a pipeline finishes or errors
export function resetToIdle(): void {
  transition("idle")
}

// Called by ipc.ts when a text query is submitted and processing begins
export function activateProcessing(): void {
  transition("processing")
}

function transition(next: HotkeyState): void {
  state = next
  onStateChange?.(next)
}
