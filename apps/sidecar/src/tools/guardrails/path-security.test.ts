import { describe, expect, it } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { checkYomiPath, isBinaryExtension, isBlockedUrl } from "./path-security.js"

describe("checkYomiPath", () => {
  const yomiRoot = join(homedir(), ".yomi")

  it("accepts a plain relative path inside ~/.yomi/", () => {
    const result = checkYomiPath("memory/foo.md")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.absolute).toBe(join(yomiRoot, "memory", "foo.md"))
  })

  it("accepts a path equal to the root", () => {
    const result = checkYomiPath(yomiRoot)
    expect(result.ok).toBe(true)
  })

  it("rejects a sibling directory path that escapes via ..", () => {
    const result = checkYomiPath("../secrets.txt")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("escapes")
  })

  it("rejects absolute paths that point outside ~/.yomi/", () => {
    const result = checkYomiPath("/etc/passwd")
    expect(result.ok).toBe(false)
  })

  it("rejects an absolute path that uses .. segments to escape", () => {
    const result = checkYomiPath(join(yomiRoot, "..", "..", "etc", "passwd"))
    expect(result.ok).toBe(false)
  })

  it("rejects NUL byte injection", () => {
    const result = checkYomiPath("memory/foo.md\0.txt")
    expect(result.ok).toBe(false)
  })

  it("rejects empty paths", () => {
    const result = checkYomiPath("")
    expect(result.ok).toBe(false)
  })

  it("accepts deeply nested paths inside the notepad", () => {
    const result = checkYomiPath("sessions/2026-06-08-topic.md")
    expect(result.ok).toBe(true)
  })
})

describe("isBlockedUrl", () => {
  it("blocks loopback and private network addresses", () => {
    expect(isBlockedUrl("http://localhost:8080/exfil")).toBe(true)
    expect(isBlockedUrl("http://127.0.0.1/foo")).toBe(true)
    expect(isBlockedUrl("http://10.0.0.5/foo")).toBe(true)
    expect(isBlockedUrl("http://192.168.1.1/foo")).toBe(true)
  })

  it("allows public URLs", () => {
    expect(isBlockedUrl("https://example.com/foo")).toBe(false)
    expect(isBlockedUrl("https://api.openai.com/v1/chat")).toBe(false)
  })

  it("handles non-string input gracefully", () => {
    // @ts-expect-error — runtime guard
    expect(isBlockedUrl(null)).toBe(false)
    // @ts-expect-error — runtime guard
    expect(isBlockedUrl(42)).toBe(false)
  })
})

describe("isBinaryExtension", () => {
  it("flags common binary formats", () => {
    expect(isBinaryExtension("report.pdf")).toBe(true)
    expect(isBinaryExtension("photo.png")).toBe(true)
    expect(isBinaryExtension("archive.zip")).toBe(true)
    expect(isBinaryExtension("installer.exe")).toBe(true)
  })

  it("returns false for text extensions", () => {
    expect(isBinaryExtension("notes.md")).toBe(false)
    expect(isBinaryExtension("config.yaml")).toBe(false)
    expect(isBinaryExtension("data.json")).toBe(false)
  })

  it("returns false when there is no extension", () => {
    expect(isBinaryExtension("Makefile")).toBe(false)
  })

  it("is case-insensitive", () => {
    expect(isBinaryExtension("photo.PNG")).toBe(true)
    expect(isBinaryExtension("notes.MD")).toBe(false)
  })
})
