import { describe, expect, it } from "bun:test"
import { driveExtract } from "./drive-extract.js"

describe("driveExtract", () => {
  it("exports Google Docs as text/plain", async () => {
    let calledWith: any = null
    const res = await driveExtract({ mimeType: "application/vnd.google-apps.document" }, async (k, m) => {
      calledWith = { k, m }
      return "doc body"
    })
    expect(res).toEqual({ text: "doc body" })
    expect(calledWith).toEqual({ k: "export", m: "text/plain" })
  })

  it("exports Sheets as CSV", async () => {
    const res = await driveExtract({ mimeType: "application/vnd.google-apps.spreadsheet" }, async () => "a,b")
    expect(res).toEqual({ text: "a,b" })
  })

  it("downloads plain text directly", async () => {
    const res = await driveExtract({ mimeType: "text/markdown" }, async (k) => {
      expect(k).toBe("media")
      return "# hi"
    })
    expect(res).toEqual({ text: "# hi" })
  })

  it("skips PDFs", async () => {
    const res = await driveExtract({ mimeType: "application/pdf" }, async () => "")
    expect(res).toEqual({ skipped: true, reason: "unsupported:application/pdf" })
  })

  it("skips folders", async () => {
    const res = await driveExtract({ mimeType: "application/vnd.google-apps.folder" }, async () => "")
    expect("skipped" in res).toBe(true)
  })
})
