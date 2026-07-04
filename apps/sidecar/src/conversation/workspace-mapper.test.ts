import { describe, expect, it } from "bun:test"
import { inferWorkspace, isDocumentRequest } from "./workspace-mapper.js"

describe("inferWorkspace", () => {
  it("identifies slides", () => {
    const r = inferWorkspace("Create a slide about AGI")
    expect(r?.app).toBe("Google Slides")
    expect(r?.keyword).toBe("slide")
  })

  it("identifies presentations", () => {
    const r = inferWorkspace("Make a presentation")
    expect(r?.app).toBe("Google Slides")
  })

  it("identifies documents", () => {
    const r = inferWorkspace("Create a document")
    expect(r?.app).toBe("Google Docs")
  })

  it("identifies spreadsheets", () => {
    const r = inferWorkspace("Make a spreadsheet")
    expect(r?.app).toBe("Google Sheets")
  })

  it("identifies sheets", () => {
    const r = inferWorkspace("Create a sheet")
    expect(r?.app).toBe("Google Sheets")
  })

  it("identifies folders", () => {
    const r = inferWorkspace("Create a folder")
    expect(r?.app).toBe("Google Drive")
  })

  it("returns undefined for text without workspace keywords", () => {
    expect(inferWorkspace("What's the weather like?")).toBeUndefined()
  })
})

describe("isDocumentRequest", () => {
  it("returns true for slide requests", () => {
    expect(isDocumentRequest("Create a slide")).toBe(true)
  })

  it("returns true for doc requests", () => {
    expect(isDocumentRequest("Write a doc")).toBe(true)
  })

  it("returns true for sheet requests", () => {
    expect(isDocumentRequest("Make a sheet")).toBe(true)
  })

  it("returns true for folder requests", () => {
    expect(isDocumentRequest("Create a folder")).toBe(true)
  })

  it("returns false for non-document requests", () => {
    expect(isDocumentRequest("Send an email")).toBe(false)
  })
})
