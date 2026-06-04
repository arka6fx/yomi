import { describe, expect, it } from "bun:test"
import { classifyBrowserRisk } from "./safety.js"
import { isBlockedDomain } from "../uia/safety.js"

describe("classifyBrowserRisk (browser MCP confirmation gating)", () => {
  it("flags file uploads", () => {
    expect(classifyBrowserRisk("browser_file_upload", { paths: ["a.pdf"] }).risky).toBe(true)
  })

  it("flags destructive click targets", () => {
    expect(classifyBrowserRisk("browser_click", { element: "Buy now button", ref: "e3" }).risky).toBe(true)
    expect(classifyBrowserRisk("browser_click", { element: "Delete account", ref: "e9" }).risky).toBe(true)
    expect(classifyBrowserRisk("browser_click", { element: "Place order", ref: "e1" }).risky).toBe(false)
  })

  it("flags destructive typed/selected text", () => {
    expect(classifyBrowserRisk("browser_select_option", { element: "row action", values: ["Delete"] }).risky).toBe(true)
  })

  it("treats ordinary navigation and clicks as safe", () => {
    expect(classifyBrowserRisk("browser_navigate", { url: "https://example.com" }).risky).toBe(false)
    expect(classifyBrowserRisk("browser_click", { element: "Read more link", ref: "e2" }).risky).toBe(false)
    expect(classifyBrowserRisk("browser_snapshot", {}).risky).toBe(false)
  })
})

describe("isBlockedDomain (refuse banking / password sites)", () => {
  it("blocks banking and password-manager hosts", () => {
    expect(isBlockedDomain("https://www.chase.com/login")).toBe(true)
    expect(isBlockedDomain("https://vault.bitwarden.com")).toBe(true)
  })
  it("allows ordinary sites", () => {
    expect(isBlockedDomain("https://news.ycombinator.com")).toBe(false)
    expect(isBlockedDomain("not a url")).toBe(false)
  })
})
