// Photos attached in the dashboard chat: shrunk in the browser before upload so they
// send fast and stay well under the backend's 5 MB per-photo limit.

export const MAX_PHOTOS = 4
const MAX_SIDE = 1600
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"]

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED.includes(file.type)
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("couldn't read that photo"))
    reader.readAsDataURL(blob)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("couldn't open that photo"))
    img.src = url
  })
}

/** A data URL for the photo, scaled so its longest side is at most 1600px. GIFs are
 * sent as they are so animations survive. */
export async function photoToDataUrl(file: File): Promise<{ url: string; mediaType: string }> {
  const original = await readAsDataUrl(file)
  if (file.type === "image/gif") return { url: original, mediaType: file.type }
  const img = await loadImage(original)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1 && file.size < 1_500_000) return { url: original, mediaType: file.type }
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height)
  // PNGs with transparency stay PNG; everything else becomes a compact JPEG.
  const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg"
  return { url: canvas.toDataURL(mediaType, 0.85), mediaType }
}
