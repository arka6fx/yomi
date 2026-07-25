import { describe, expect, it } from "bun:test"
import { resolveAssetType } from "./asset-storage.js"

describe("resolveAssetType", () => {
  it("uses the extension for a known content type", () => {
    expect(resolveAssetType("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({
      extension: "jpg",
      contentType: "image/jpeg",
    })
  })

  it("sniffs a PNG from its magic bytes when the content type is generic", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(resolveAssetType("application/octet-stream", pngBytes)).toEqual({
      extension: "png",
      contentType: "image/png",
    })
  })

  it("falls back to .bin when the content type is unknown and the bytes aren't recognized", () => {
    expect(resolveAssetType("application/octet-stream", new Uint8Array([1, 2, 3]))).toEqual({
      extension: "bin",
      contentType: "application/octet-stream",
    })
  })
})
