import { globalShortcut, app } from "electron"

export type HotkeyState = "idle" | "listening" | "processing" | "text-input"

let state: HotkeyState = "idle"
let enabled = false // Gated by auth — false while signed out
let initialized = false // Shortcuts registered once at first auth
let suspended = false // True while overlay is hidden — shortcuts fully unregistered
let voiceLoop = false // True while a hands-free voice turn should re-listen after it completes

let onStateChange: ((s: HotkeyState) => void) | null = null
let onListenStop: (() => void) | null = null
let onTextQuery: (() => void) | null = null
let onAbort: (() => void) | null = null
let onAnyEscape: (() => void) | null = null // fired on every ESC, regardless of state
let onScreenshot: (() => void) | null = null
let onLoopContinue: (() => void) | null = null // ask the renderer to re-listen for the next task

// Register the three AI-interaction shortcuts.
// Called on init and again on resumeHotkeys() after a hide.
function registerAiShortcuts(): void {
  globalShortcut.register("Ctrl+Space", () => {
    if (!enabled) return
    // Ctrl+Space starts a hands-free voice session: keep listening for the next
    // task after each turn until ESC.
    if (state === "idle") {
      voiceLoop = true
      transition("listening")
    }
  })

  globalShortcut.register("Ctrl+Return", () => {
    if (!enabled) return
    if (state === "idle") {
      voiceLoop = false // typed queries are single-shot, never looped
      transition("text-input")
      onTextQuery?.()
    }
  })

  // Screenshot — capture the screen and analyse it straight into chat (no state change here;
  // the screenshot runner flips to processing itself).
  globalShortcut.register("Ctrl+S", () => {
    if (!enabled) return
    if (state === "idle") {
      voiceLoop = false // one-shot screen analysis, never looped
      onScreenshot?.()
    }
  })

  // Escape — can fail silently on some Windows setups; IPC fallback covers that case.
  const escOk = globalShortcut.register("Escape", () => triggerEscape())
  if (!escOk)
    console.warn("[yomi/hotkey] Escape global shortcut failed to register — IPC fallback active")
}

// Called once after first successful auth. Safe to call again on re-auth —
// subsequent calls update the callbacks and re-enable without re-registering shortcuts.
export function initHotkey(opts: {
  onStateChange: (s: HotkeyState) => void
  onListenStop: () => void
  onTextQuery: () => void
  onAbort: () => void
  onAnyEscape?: () => void
  onScreenshot?: () => void
  onLoopContinue?: () => void
}): void {
  onStateChange = opts.onStateChange
  onListenStop = opts.onListenStop
  onTextQuery = opts.onTextQuery
  onAbort = opts.onAbort
  onAnyEscape = opts.onAnyEscape ?? null
  onScreenshot = opts.onScreenshot ?? null
  onLoopContinue = opts.onLoopContinue ?? null

  if (!initialized) {
    initialized = true
    registerAiShortcuts()
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
  voiceLoop = false
  if (state !== "idle") transition("idle")
}

// Unregister all AI shortcuts so the underlying app receives them while hidden.
export function suspendHotkeys(): void {
  if (suspended) return
  suspended = true
  enabled = false
  voiceLoop = false
  if (state !== "idle") transition("idle")
  globalShortcut.unregister("Ctrl+Space")
  globalShortcut.unregister("Ctrl+Return")
  globalShortcut.unregister("Ctrl+S")
  globalShortcut.unregister("Escape")
  globalShortcut.unregister("Return") // defensive — may be registered if state was listening
}

// Re-register AI shortcuts when the overlay becomes visible again.
export function resumeHotkeys(): void {
  if (!suspended) return
  suspended = false
  registerAiShortcuts()
  enabled = true
}

// IPC fallback for when globalShortcut("Escape") fails to register.
// Called directly by the main-process IPC handler when the renderer sends yomi:escape.
export function triggerEscape(): void {
  voiceLoop = false // ESC always breaks the hands-free loop
  onAnyEscape?.() // always fires — stops TTS even when state is idle
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

// Called by ipc.ts when a voice turn completes. In a hands-free session this
// returns to idle and asks the renderer to re-listen (once any TTS drains);
// otherwise it behaves like resetToIdle.
export function endVoiceTurn(): void {
  transition("idle")
  if (voiceLoop && enabled && !suspended) onLoopContinue?.()
}

export function isVoiceLoopActive(): boolean {
  return voiceLoop
}

// Called by ipc.ts when a text query is submitted and processing begins.
export function activateProcessing(): void {
  transition("processing")
}

// Called via IPC when the user clicks the Voice button in the toolbar, and when
// the renderer re-arms the mic for the next task in a hands-free loop.
export function triggerVoiceMode(): boolean {
  if (!enabled || state !== "idle") return false
  voiceLoop = true
  transition("listening")
  return true
}

// Barge-in: the user spoke over Yomi while it was processing/speaking. Start a
// fresh hands-free listening turn (the pipeline abort happens in ipc.ts).
export function bargeInToListening(): void {
  if (!enabled || suspended) return
  voiceLoop = true
  transition("listening")
}

// Called via IPC when the user clicks the Send/Enter chip while listening.
export function triggerStopListening(): boolean {
  if (!enabled || state !== "listening") return false
  transition("processing")
  onListenStop?.()
  return true
}

// Called via IPC when the user clicks the Type button in the toolbar.
export function triggerTextMode(): void {
  if (!enabled || state !== "idle") return
  voiceLoop = false // typed queries are single-shot, never looped
  transition("text-input")
  onTextQuery?.()
}

export function getHotkeyState(): HotkeyState {
  return state
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
