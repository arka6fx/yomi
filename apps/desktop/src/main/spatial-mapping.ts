import type { PointTarget } from "@yomi/shared"
import type { DisplayCapture, ScreenCapture } from "./capture"

export interface ScreenPoint {
  x: number
  y: number
  label: string
}

export function displayForScreen(
  capture: ScreenCapture,
  screenNumber?: number,
): DisplayCapture | null {
  if (screenNumber !== undefined) {
    return capture.displays.find((d) => d.screen === screenNumber) ?? capture.displays[0] ?? null
  }
  return (
    capture.displays.find((d) => d.isCursorScreen || d.is_cursor_screen) ??
    capture.displays[0] ??
    null
  )
}

export function mapPointTargetToScreen(
  target: PointTarget,
  capture: ScreenCapture,
): ScreenPoint | null {
  const display = displayForScreen(capture, target.screen)
  if (!display) return null

  const x =
    target.coordinateSpace === "normalized"
      ? display.bounds.x + target.x * display.bounds.width
      : display.bounds.x + (target.x / Math.max(display.imageWidth, 1)) * display.bounds.width
  const y =
    target.coordinateSpace === "normalized"
      ? display.bounds.y + target.y * display.bounds.height
      : display.bounds.y + (target.y / Math.max(display.imageHeight, 1)) * display.bounds.height

  return { x: Math.round(x), y: Math.round(y), label: target.label }
}

export function mapGuideElementToScreen(
  element:
    | { label: string; bbox: { x: number; y: number; width: number; height: number } }
    | undefined,
  capture: ScreenCapture,
): ScreenPoint | null {
  if (!element?.bbox) return null
  const display = displayForScreen(capture)
  if (!display) return null

  const looksNormalized =
    element.bbox.x <= 1 &&
    element.bbox.y <= 1 &&
    element.bbox.width <= 1 &&
    element.bbox.height <= 1
  const centerX = element.bbox.x + element.bbox.width / 2
  const centerY = element.bbox.y + element.bbox.height / 2

  const x = looksNormalized
    ? display.bounds.x + centerX * display.bounds.width
    : display.bounds.x + (centerX / Math.max(display.imageWidth, 1)) * display.bounds.width
  const y = looksNormalized
    ? display.bounds.y + centerY * display.bounds.height
    : display.bounds.y + (centerY / Math.max(display.imageHeight, 1)) * display.bounds.height

  return {
    x: Math.round(x),
    y: Math.round(y),
    label: element.label,
  }
}
