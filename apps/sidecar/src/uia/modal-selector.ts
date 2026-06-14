// Multi-Modal Action Selector — confidence-based routing between UIA / Browser / Vision / Keyboard / Mouse.
// Dynamically chooses the best modality for each action.

import type { UiaElement } from "@yomi/shared"

export type ActionModality = "uia" | "browser" | "vision" | "keyboard" | "mouse" | "os_api" | "clipboard"

interface ModalityScore {
  modality: ActionModality
  confidence: number
  reason: string
}

// ===========================================================================
// Confidence scoring per modality
// ===========================================================================

function scoreUIA(el?: UiaElement | null): ModalityScore {
  if (!el) return { modality: "uia", confidence: 0, reason: "no element" }
  if (el.offscreen) return { modality: "uia", confidence: 0.2, reason: "element offscreen" }
  if (!el.enabled) return { modality: "uia", confidence: 0.3, reason: "element disabled" }
  if (el.automationId) return { modality: "uia", confidence: 0.95, reason: "automationId available" }
  if (el.patterns.includes("Invoke") || el.patterns.includes("Value") || el.patterns.includes("Toggle"))
    return { modality: "uia", confidence: 0.85, reason: "standard patterns available" }
  return { modality: "uia", confidence: 0.6, reason: "element found but minimal patterns" }
}

function scoreBrowser(url?: string): ModalityScore {
  if (!url) return { modality: "browser", confidence: 0, reason: "no URL" }
  if (/^https?:\/\//.test(url)) return { modality: "browser", confidence: 0.9, reason: "valid URL" }
  return { modality: "browser", confidence: 0.4, reason: "URL-like string" }
}

function scoreVision(imageAvailable: boolean): ModalityScore {
  if (!imageAvailable) return { modality: "vision", confidence: 0, reason: "no image" }
  return { modality: "vision", confidence: 0.5, reason: "image available, UIA fallback" }
}

function scoreKeyboard(shortcut: string | null): ModalityScore {
  if (!shortcut) return { modality: "keyboard", confidence: 0, reason: "no shortcut" }
  if (/^Ctrl\+|^Alt\+|^Win\+|^F\d/i.test(shortcut)) return { modality: "keyboard", confidence: 0.8, reason: `reliable shortcut: ${shortcut}` }
  return { modality: "keyboard", confidence: 0.5, reason: `single key: ${shortcut}` }
}

function scoreMouse(target?: { x: number; y: number } | null): ModalityScore {
  if (!target) return { modality: "mouse", confidence: 0, reason: "no coordinates" }
  return { modality: "mouse", confidence: 0.7, reason: `coordinates available (${target.x},${target.y})` }
}

function scoreClipboard(textLength: number): ModalityScore {
  if (textLength > 100) return { modality: "clipboard", confidence: 0.9, reason: "large text — clipboard faster" }
  if (textLength > 20) return { modality: "clipboard", confidence: 0.7, reason: "medium text — clipboard reliable" }
  return { modality: "clipboard", confidence: 0.3, reason: "short text — keyboard may suffice" }
}

// ===========================================================================
// Select best modality for an action
// ===========================================================================

export type ActionType = "click" | "type_text" | "navigate" | "scroll" | "select" | "toggle" | "hover" | "drag"

interface SelectorContext {
  actionType: ActionType
  uiaElement?: UiaElement | null
  browserUrl?: string
  imageAvailable?: boolean
  keyboardShortcut?: string | null
  mouseTarget?: { x: number; y: number } | null
  textLength?: number
}

export function selectModality(ctx: SelectorContext): ModalityScore[] {
  const scores: ModalityScore[] = []

  switch (ctx.actionType) {
    case "click":
      scores.push(scoreUIA(ctx.uiaElement))
      scores.push(scoreMouse(ctx.mouseTarget))
      scores.push(scoreKeyboard(ctx.keyboardShortcut ?? null))
      scores.push(scoreVision(ctx.imageAvailable ?? false))
      break
    case "type_text":
      scores.push(scoreClipboard(ctx.textLength ?? 0))
      scores.push(scoreUIA(ctx.uiaElement))
      scores.push(scoreKeyboard(ctx.keyboardShortcut ?? null))
      break
    case "navigate":
      scores.push(scoreBrowser(ctx.browserUrl))
      scores.push(scoreKeyboard(ctx.keyboardShortcut ?? null))
      break
    case "scroll":
      scores.push(scoreUIA(ctx.uiaElement))
      scores.push(scoreKeyboard(ctx.keyboardShortcut ?? "Down"))
      break
    case "select":
    case "toggle":
    case "hover":
    case "drag":
      scores.push(scoreUIA(ctx.uiaElement))
      scores.push(scoreMouse(ctx.mouseTarget))
      break
  }

  // Always consider UIA as baseline
  if (!scores.some((s) => s.modality === "uia")) {
    scores.push(scoreUIA(ctx.uiaElement))
  }

  return scores.sort((a, b) => b.confidence - a.confidence)
}

export function bestModality(ctx: SelectorContext): ModalityScore {
  return selectModality(ctx)[0]!
}
