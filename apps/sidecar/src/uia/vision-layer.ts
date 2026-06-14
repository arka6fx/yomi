// Vision Automation Layer — screen capture, OCR, VLM, template matching.
// Screen capture is native (Win32 GDI via C# helper). OCR and VLMs require external services.
// Set env vars for API keys: YOMI_OCR_PROVIDER, YOMI_VLM_PROVIDER, YOMI_OPENAI_API_KEY, etc.

import { createHash } from "node:crypto"
import type { UiaElement } from "@yomi/shared"
import { uia } from "./client.js"
import { isBlockedApp } from "./safety.js"

export type OcrRegion = { x: number; y: number; width: number; height: number }
export type OcrBox = OcrRegion & { text: string; confidence?: number }
export type OcrResult = { ok: boolean; text?: string; boxes?: OcrBox[]; error?: string; cached?: boolean }
export type ScreenDiff = {
  changed: boolean
  beforeHash: string
  afterHash: string
  byteDeltaRatio: number
  sizeChanged: boolean
}

const ocrCache = new Map<string, OcrResult>()
const MAX_OCR_CACHE_ENTRIES = 64

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

export function createRegionOcrCacheKey(imageB64: string, region: OcrRegion): string {
  const r = normalizeRegion(region)
  return sha256(`${sha256(imageB64)}:${r.x},${r.y},${r.width},${r.height}`)
}

export function normalizeOcrText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function normalizeRegion(region: OcrRegion): OcrRegion {
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.max(0, Math.round(region.width)),
    height: Math.max(0, Math.round(region.height)),
  }
}

function parseBoundingBox(value: unknown): OcrRegion | null {
  if (typeof value === "string") {
    const parts = value.split(",").map((part) => Number(part.trim()))
    if (parts.length >= 4 && parts.every(Number.isFinite)) {
      const [x = 0, y = 0, width = 0, height = 0] = parts
      return { x, y, width, height }
    }
  }
  if (Array.isArray(value)) {
    const nums = value.flat().map((part) => Number(part))
    if (nums.length >= 4 && nums.every(Number.isFinite)) {
      const xs = nums.filter((_, i) => i % 2 === 0)
      const ys = nums.filter((_, i) => i % 2 === 1)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
    }
  }
  if (typeof value === "object" && value !== null) {
    const box = value as Record<string, unknown>
    const x = Number(box.x ?? box.left)
    const y = Number(box.y ?? box.top)
    const width = Number(box.width ?? box.w)
    const height = Number(box.height ?? box.h)
    if ([x, y, width, height].every(Number.isFinite)) return { x, y, width, height }
  }
  return null
}

function normalizeOcrBox(raw: unknown, offset: OcrRegion): OcrBox | null {
  if (typeof raw !== "object" || raw === null) return null
  const item = raw as Record<string, unknown>
  const text = normalizeOcrText(String(item.text ?? item.label ?? item.word ?? ""))
  if (!text) return null
  const rect = parseBoundingBox(item.rect ?? item.box ?? item.boundingBox ?? item.bounds)
  if (!rect) return null
  const confidence = Number(item.confidence ?? item.score)
  return {
    x: offset.x + Math.round(rect.x),
    y: offset.y + Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
    text,
    ...(Number.isFinite(confidence) ? { confidence } : {}),
  }
}

export function normalizeOcrResult(raw: unknown, offset: OcrRegion = { x: 0, y: 0, width: 0, height: 0 }): OcrResult {
  if (typeof raw === "string") return { ok: true, text: normalizeOcrText(raw), boxes: [] }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid OCR result" }
  const result = raw as Record<string, unknown>
  const candidates = result.boxes ?? result.words ?? result.lines ?? result.results
  const boxes = Array.isArray(candidates)
    ? candidates.map((item) => normalizeOcrBox(item, offset)).filter((box): box is OcrBox => !!box)
    : []
  const text = normalizeOcrText(
    String(result.text ?? boxes.map((box) => box.text).join(" ")),
  )
  return { ok: result.ok !== false, text, boxes, ...(typeof result.error === "string" ? { error: result.error } : {}) }
}

export function computeScreenDiff(beforeImageB64: string, afterImageB64: string): ScreenDiff {
  const before = Buffer.from(beforeImageB64, "base64")
  const after = Buffer.from(afterImageB64, "base64")
  const max = Math.max(before.length, after.length)
  let changed = Math.abs(before.length - after.length)
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (before[i] !== after[i]) changed++
  }
  return {
    changed: changed > 0,
    beforeHash: sha256(before),
    afterHash: sha256(after),
    byteDeltaRatio: max === 0 ? 0 : changed / max,
    sizeChanged: before.length !== after.length,
  }
}

export async function captureScreenDiff(
  action?: () => Promise<unknown>,
  options: { screen?: number; settleMs?: number } = {},
): Promise<{ ok: boolean; diff?: ScreenDiff; actionResult?: unknown; error?: string }> {
  const before = await captureScreen(options.screen ?? 0)
  if (!before.ok || !before.image_b64) return { ok: false, error: "before capture failed" }
  const actionResult = action ? await action() : undefined
  if (options.settleMs && options.settleMs > 0) await new Promise((r) => setTimeout(r, options.settleMs))
  const after = await captureScreen(options.screen ?? 0)
  if (!after.ok || !after.image_b64) return { ok: false, error: "after capture failed", actionResult }
  return { ok: true, diff: computeScreenDiff(before.image_b64, after.image_b64), actionResult }
}

function rememberOcr(cacheKey: string, result: OcrResult): OcrResult {
  if (ocrCache.size >= MAX_OCR_CACHE_ENTRIES) {
    const oldest = ocrCache.keys().next().value
    if (oldest) ocrCache.delete(oldest)
  }
  ocrCache.set(cacheKey, result)
  return result
}

export function clearOcrCache(): void {
  ocrCache.clear()
}

// ===========================================================================
// Screen capture (native — no API keys needed)
// ===========================================================================

export async function captureScreen(screen = 0) {
  return uia.captureScreen(screen)
}

export async function captureRegion(x: number, y: number, width: number, height: number) {
  return uia.captureRegion(x, y, width, height)
}

export async function captureWindow(hwnd?: number) {
  return uia.windowScreenshot(hwnd)
}

// ===========================================================================
// OCR — requires external service. Configure YOMI_OCR_PROVIDER.
// Supported: "paddleocr", "easyocr" (Python subprocess), "tesseract" (CLI), "azure" (API key)
// ===========================================================================

export async function ocrScreen(screen = 0): Promise<OcrResult> {
  const capture = await captureScreen(screen)
  if (!capture.ok || !capture.image_b64) return { ok: false, error: "capture failed" }
  return runOCR(capture.image_b64, { x: 0, y: 0, width: capture.width ?? 0, height: capture.height ?? 0 })
}

export async function ocrRegion(x: number, y: number, width: number, height: number): Promise<OcrResult> {
  const capture = await captureRegion(x, y, width, height)
  if (!capture.ok || !capture.image_b64) return { ok: false, error: "capture failed" }
  const region = normalizeRegion({ x, y, width, height })
  const cacheKey = createRegionOcrCacheKey(capture.image_b64, region)
  const cached = ocrCache.get(cacheKey)
  if (cached) return { ...cached, cached: true }
  return rememberOcr(cacheKey, await runOCR(capture.image_b64, region))
}

async function runOCR(imageB64: string, offset: OcrRegion = { x: 0, y: 0, width: 0, height: 0 }): Promise<OcrResult> {
  const provider = process.env.YOMI_OCR_PROVIDER || "none"

  if (provider === "none") {
    return { ok: false, error: "No OCR provider configured. Set YOMI_OCR_PROVIDER to 'tesseract', 'easyocr', 'paddleocr', or 'azure'." }
  }

  if (provider === "tesseract") {
    // Requires tesseract.exe on PATH
    try {
      const { writeFile, unlink } = await import("node:fs/promises")
      const { join } = await import("node:path")
      const { homedir } = await import("node:os")
      const tmpFile = join(homedir(), ".yomi", "tmp", `ocr-${Date.now()}.png`)
      await writeFile(tmpFile, Buffer.from(imageB64, "base64"))
      const proc = Bun.spawn(["tesseract", tmpFile, "stdout", "-l", "eng"], { stdout: "pipe", stderr: "pipe" })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      try { await unlink(tmpFile) } catch { /* ignore */ }
      return normalizeOcrResult(text, offset)
    } catch (e) {
      return { ok: false, error: `tesseract failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  if (provider === "azure") {
    // Azure Cognitive Services — requires YOMI_AZURE_VISION_KEY + YOMI_AZURE_VISION_ENDPOINT
    const key = process.env.YOMI_AZURE_VISION_KEY
    const endpoint = process.env.YOMI_AZURE_VISION_ENDPOINT
    if (!key || !endpoint) return { ok: false, error: "Set YOMI_AZURE_VISION_KEY and YOMI_AZURE_VISION_ENDPOINT" }
    try {
      const res = await fetch(`${endpoint}/vision/v3.2/ocr?language=en`, {
        method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream" },
        body: Buffer.from(imageB64, "base64"),
      })
      const data = await res.json() as { regions?: { lines?: { words?: { text: string; boundingBox?: string }[] }[] }[] }
      const words = data.regions?.flatMap((r) => r.lines?.flatMap((l) => l.words ?? []) ?? []) ?? []
      return normalizeOcrResult({ ok: true, words }, offset)
    } catch (e) {
      return { ok: false, error: `Azure OCR failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  // For PaddleOCR/EasyOCR: these run as Python subprocesses with pip-installed packages
  if (provider === "paddleocr" || provider === "easyocr") {
    try {
      const { writeFile, unlink } = await import("node:fs/promises")
      const { join } = await import("node:path")
      const { homedir } = await import("node:os")
      const tmpFile = join(homedir(), ".yomi", "tmp", `ocr-${Date.now()}.png`)
      await writeFile(tmpFile, Buffer.from(imageB64, "base64"))
      const script = provider === "paddleocr"
        ? `from paddleocr import PaddleOCR; ocr = PaddleOCR(use_angle_cls=True, lang='en'); result = ocr.ocr('${tmpFile.replace(/\\/g, "/")}'); print(' '.join([line[1][0] for line in result[0]]))`
        : `import easyocr; reader = easyocr.Reader(['en']); result = reader.readtext('${tmpFile.replace(/\\/g, "/")}'); print(' '.join([r[1] for r in result]))`
      const proc = Bun.spawn(["python", "-c", script], { stdout: "pipe", stderr: "pipe" })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      try { await unlink(tmpFile) } catch { /* ignore */ }
      return normalizeOcrResult(text, offset)
    } catch (e) {
      return { ok: false, error: `${provider} failed (is Python + package installed?): ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  return { ok: false, error: `Unknown OCR provider: ${provider}` }
}

// ===========================================================================
// VLM (Vision Language Model) — for visual grounding, screen description.
// Requires API key. Set YOMI_VLM_PROVIDER to "openai", "anthropic", or "local".
// ===========================================================================

export async function screenDescribe(imageB64?: string): Promise<{ ok: boolean; description?: string; error?: string }> {
  const provider = process.env.YOMI_VLM_PROVIDER || "none"
  if (provider === "none") {
    return { ok: false, error: "No VLM provider configured. Set YOMI_VLM_PROVIDER to 'openai' or 'anthropic'. Requires YOMI_OPENAI_API_KEY or YOMI_ANTHROPIC_API_KEY." }
  }

  const img = imageB64 || (await captureScreen()).image_b64
  if (!img) return { ok: false, error: "no image" }

  if (provider === "openai") {
    const key = process.env.YOMI_OPENAI_API_KEY
    if (!key) return { ok: false, error: "Set YOMI_OPENAI_API_KEY" }
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Describe this desktop screenshot. List all visible windows, buttons, text fields, and interactive elements with their approximate positions." },
              { type: "image_url", image_url: { url: `data:image/png;base64,${img}` } },
            ],
          }],
          max_tokens: 500,
        }),
      })
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      return { ok: true, description: data.choices?.[0]?.message?.content ?? "no response" }
    } catch (e) {
      return { ok: false, error: `VLM failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  if (provider === "anthropic") {
    const key = process.env.YOMI_ANTHROPIC_API_KEY
    if (!key) return { ok: false, error: "Set YOMI_ANTHROPIC_API_KEY" }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Describe this desktop screenshot. List all visible windows, buttons, text fields, and interactive elements with their approximate positions." },
              { type: "image", source: { type: "base64", media_type: "image/png", data: img } },
            ],
          }],
        }),
      })
      const data = await res.json() as { content?: { text?: string }[] }
      return { ok: true, description: data.content?.[0]?.text ?? "no response" }
    } catch (e) {
      return { ok: false, error: `VLM failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  return { ok: false, error: `Unknown VLM provider: ${provider}` }
}

// Locate an element by visual description (visual grounding)
export function groundTextFromOcr(
  description: string,
  result: OcrResult,
  elements: UiaElement[] = [],
): { ok: boolean; x?: number; y?: number; width?: number; height?: number; text?: string; uiaRef?: string; error?: string } {
  const needle = normalizeOcrText(description).toLowerCase()
  if (!needle) return { ok: false, error: "empty visual query" }
  const boxes = result.boxes ?? []
  const match = boxes.find((box) => box.text.toLowerCase().includes(needle))
    ?? boxes.find((box) => needle.includes(box.text.toLowerCase()))
  if (!match) return { ok: false, error: "text not found in OCR result" }
  const cx = match.x + match.width / 2
  const cy = match.y + match.height / 2
  let nearest: UiaElement | undefined
  let nearestScore = Number.POSITIVE_INFINITY
  for (const el of elements) {
    if (el.offscreen || el.rect.width <= 0 || el.rect.height <= 0) continue
    const ex = el.rect.x + el.rect.width / 2
    const ey = el.rect.y + el.rect.height / 2
    const contains = cx >= el.rect.x && cx <= el.rect.x + el.rect.width && cy >= el.rect.y && cy <= el.rect.y + el.rect.height
    const score = contains ? 0 : Math.hypot(cx - ex, cy - ey)
    if (score < nearestScore) {
      nearest = el
      nearestScore = score
    }
  }
  return { ok: true, x: match.x, y: match.y, width: match.width, height: match.height, text: match.text, uiaRef: nearest?.ref }
}

// Locate text visually. This is deliberately opt-in and intended only after UIA/pattern paths fail.
export async function findVisualElement(
  description: string,
  options: { enabled?: boolean; elements?: UiaElement[] } = {},
): Promise<{ ok: boolean; x?: number; y?: number; width?: number; height?: number; text?: string; uiaRef?: string; error?: string }> {
  if (!options.enabled) return { ok: false, error: "visual grounding is opt-in; pass enabled: true after UIA paths fail" }
  if (isBlockedApp(uia.lastWindow)) return { ok: false, error: `Refusing visual grounding on "${uia.lastWindow}" — blocklisted app.` }

  const capture = await captureScreen()
  if (!capture.ok || !capture.image_b64) return { ok: false, error: "capture failed" }
  const ocr = await runOCR(capture.image_b64, { x: 0, y: 0, width: capture.width ?? 0, height: capture.height ?? 0 })
  if (!ocr.ok) return ocr
  return groundTextFromOcr(description, ocr, options.elements)
}

// Wait for a visual element to appear
export async function waitForVisual(description: string, maxAttempts = 10, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await findVisualElement(description, { enabled: true })
    if (result.ok) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}
