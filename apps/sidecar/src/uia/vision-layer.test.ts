import { describe, expect, it } from "bun:test"
import type { UiaElement } from "@yomi/shared"
import {
  computeScreenDiff,
  createRegionOcrCacheKey,
  findVisualElement,
  groundTextFromOcr,
  normalizeOcrResult,
  normalizeOcrText,
} from "./vision-layer.js"
import { uia } from "./client.js"

function el(over: Partial<UiaElement> & { ref?: string } = {}): UiaElement {
  return {
    ref: over.ref ?? "w1e1",
    role: "Button",
    name: "",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    patterns: [],
    enabled: true,
    ...over,
  }
}

describe("vision OCR normalization", () => {
  it("normalizes OCR text whitespace", () => {
    expect(normalizeOcrText("  hello\n\tworld  ")).toBe("hello world")
  })

  it("normalizes boxed OCR results and offsets them into screen coordinates", () => {
    const result = normalizeOcrResult(
      {
        words: [
          { text: "Save", boundingBox: "5,6,20,8", confidence: 0.9 },
          { text: "", boundingBox: "1,1,1,1" },
        ],
      },
      { x: 100, y: 200, width: 300, height: 80 },
    )

    expect(result.ok).toBe(true)
    expect(result.text).toBe("Save")
    expect(result.boxes).toEqual([{ text: "Save", x: 105, y: 206, width: 20, height: 8, confidence: 0.9 }])
  })

  it("normalizes polygon boxes", () => {
    const result = normalizeOcrResult({ boxes: [{ text: "Menu", box: [[10, 20], [50, 20], [50, 40], [10, 40]] }] })

    expect(result.boxes?.[0]).toMatchObject({ text: "Menu", x: 10, y: 20, width: 40, height: 20 })
  })

  it("creates stable cache keys from image content and rounded regions", () => {
    const image = Buffer.from("same pixels").toString("base64")
    const a = createRegionOcrCacheKey(image, { x: 1.2, y: 2.4, width: 10.1, height: 20.2 })
    const b = createRegionOcrCacheKey(image, { x: 1, y: 2, width: 10, height: 20 })
    const c = createRegionOcrCacheKey(image, { x: 1, y: 2, width: 11, height: 20 })

    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe("screen diff", () => {
  it("reports unchanged images", () => {
    const image = Buffer.from([1, 2, 3]).toString("base64")
    const diff = computeScreenDiff(image, image)

    expect(diff.changed).toBe(false)
    expect(diff.byteDeltaRatio).toBe(0)
    expect(diff.beforeHash).toBe(diff.afterHash)
  })

  it("reports byte-level changes", () => {
    const before = Buffer.from([1, 2, 3, 4]).toString("base64")
    const after = Buffer.from([1, 9, 3, 8]).toString("base64")
    const diff = computeScreenDiff(before, after)

    expect(diff.changed).toBe(true)
    expect(diff.byteDeltaRatio).toBe(0.5)
    expect(diff.sizeChanged).toBe(false)
  })
})

describe("visual text grounding", () => {
  it("requires explicit opt-in before capturing the screen", async () => {
    const result = await findVisualElement("Save")

    expect(result).toEqual({ ok: false, error: "visual grounding is opt-in; pass enabled: true after UIA paths fail" })
  })

  it("refuses blocklisted apps before capture", async () => {
    const previous = uia.lastWindow
    uia.lastWindow = "1Password"
    const result = await findVisualElement("password", { enabled: true })
    uia.lastWindow = previous

    expect(result).toEqual({ ok: false, error: 'Refusing visual grounding on "1Password" — blocklisted app.' })
  })

  it("maps OCR text boxes to screen coordinates and nearest UIA ref", () => {
    const result = groundTextFromOcr(
      "save",
      { ok: true, text: "Save", boxes: [{ text: "Save", x: 120, y: 210, width: 40, height: 20 }] },
      [
        el({ ref: "w1e2", name: "Cancel", rect: { x: 0, y: 0, width: 40, height: 20 } }),
        el({ ref: "w1e3", name: "Save", rect: { x: 110, y: 200, width: 80, height: 40 } }),
      ],
    )

    expect(result).toMatchObject({ ok: true, x: 120, y: 210, width: 40, height: 20, text: "Save", uiaRef: "w1e3" })
  })

  it("returns a typed miss instead of fabricating a visual target", () => {
    const result = groundTextFromOcr("delete", { ok: true, text: "Save", boxes: [{ text: "Save", x: 0, y: 0, width: 10, height: 10 }] })

    expect(result).toEqual({ ok: false, error: "text not found in OCR result" })
  })
})
