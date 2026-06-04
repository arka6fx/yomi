import { desktopCapturer, screen } from "electron"
import type { NativeImage } from "electron"
import type { ScreenImage } from "@yomi/shared"

export interface DisplayCapture extends ScreenImage {
  displayId: string
  isCursorScreen: boolean
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  imageWidth: number
  imageHeight: number
}

export interface ScreenCapture {
  screenshot_b64: string
  screen_width: number // physical pixels (bounds * scaleFactor, handles HiDPI + Retina)
  screen_height: number
  displays: DisplayCapture[]
}

// main-process only — never import in preload or renderer
export async function captureScreen(): Promise<ScreenCapture> {
  const primary = screen.getPrimaryDisplay()
  const screen_width = Math.round(primary.bounds.width * primary.scaleFactor)
  const screen_height = Math.round(primary.bounds.height * primary.scaleFactor)
  try {
    const displays = screen.getAllDisplays()
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    })
    const captures: DisplayCapture[] = []
    const cursorPoint = screen.getCursorScreenPoint()
    const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)

    for (const [index, source] of sources.entries()) {
      const display =
        displays.find((d) => String(d.id) === source.display_id) ?? displays[index] ?? primary
      const thumb: NativeImage = source.thumbnail
      const thumbSize = thumb.getSize()
      const targetWidth = Math.min(1280, thumbSize.width)
      const scaled = thumb.resize({ width: targetWidth })
      const scaledSize = scaled.getSize()
      captures.push({
        screen: index + 1,
        displayId: String(display.id),
        isCursorScreen: display.id === cursorDisplay.id,
        is_cursor_screen: display.id === cursorDisplay.id,
        screenshot_b64: scaled.toJPEG(75).toString("base64"),
        width: scaledSize.width,
        height: scaledSize.height,
        imageWidth: scaledSize.width,
        imageHeight: scaledSize.height,
        scaleFactor: display.scaleFactor,
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
      })
    }

    const first = captures[0]
    return {
      screenshot_b64: first?.screenshot_b64 ?? "",
      screen_width,
      screen_height,
      displays: captures,
    }
  } catch {
    return { screenshot_b64: "", screen_width, screen_height, displays: [] }
  }
}
