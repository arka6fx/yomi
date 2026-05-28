import { desktopCapturer, screen } from "electron"
import type { NativeImage } from "electron"

export interface ScreenCapture {
  screenshot_b64: string
  screen_width: number   // physical pixels (bounds * scaleFactor, handles HiDPI + Retina)
  screen_height: number
}

// main-process only — never import in preload or renderer
export async function captureScreen(): Promise<ScreenCapture> {
  const d = screen.getPrimaryDisplay()
  const screen_width  = Math.round(d.bounds.width  * d.scaleFactor)
  const screen_height = Math.round(d.bounds.height * d.scaleFactor)
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    })
    const thumb: NativeImage = sources[0]!.thumbnail
    const scaled = thumb.resize({ width: Math.min(1280, thumb.getSize().width) })
    return { screenshot_b64: scaled.toJPEG(75).toString("base64"), screen_width, screen_height }
  } catch {
    return { screenshot_b64: "", screen_width, screen_height }
  }
}
