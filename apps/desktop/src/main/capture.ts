import { desktopCapturer } from "electron"
import type { NativeImage } from "electron"

// main-process only — never import in preload or renderer
export async function captureScreen(): Promise<string> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    })
    const thumb: NativeImage = sources[0]!.thumbnail
    const scaled = thumb.resize({ width: Math.min(1280, thumb.getSize().width) })
    return scaled.toJPEG(75).toString("base64")
  } catch {
    return "" // screenshot failure is non-fatal; sidecar accepts empty screenshot_b64
  }
}
