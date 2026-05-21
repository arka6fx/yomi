import { globalShortcut, app } from "electron"

type HotkeyState = "idle" | "listening" | "processing"

let state: HotkeyState = "idle"
let onStateChange: ((s: HotkeyState) => void) | null = null
let onListenStop: (() => void) | null = null

// Must be called after app.whenReady() resolves
export function initHotkey(opts: {
  onStateChange: (s: HotkeyState) => void
  onListenStop: () => void
}): void {
  onStateChange = opts.onStateChange
  onListenStop = opts.onListenStop

  globalShortcut.register("Ctrl+Shift+Space", () => {
    if (state === "idle") {
      transition("listening")
    } else if (state === "listening") {
      transition("processing")
      onListenStop?.()
    }
    // ignore hotkey during processing — pipeline is in flight
  })

  // Cancel recording; does nothing when processing or idle
  globalShortcut.register("Escape", () => {
    if (state === "listening") transition("idle")
  })

  app.on("will-quit", () => globalShortcut.unregisterAll())
}

// Called by ipc.ts when done/error arrives from sidecar
export function resetToIdle(): void {
  transition("idle")
}

function transition(next: HotkeyState): void {
  state = next
  onStateChange?.(next)
}
