import { describe, expect, it } from "bun:test"
import type { ToolSet } from "ai"
import { resolveAgent, scopeTools } from "./registry.js"

// scopeTools only inspects keys, so a bag of empty tool stubs is enough to exercise it.
const allTools = {
  play_spotify: {},
  control_spotify: {},
  adjust_spotify_volume: {},
  look_at_screen: {},
  read_file: {},
  search: {},
  web_search: {},
  fetch_url: {},
  send_whatsapp_message: {},
  launch_app: {},
  browser_navigate: {},
  browser_click: {},
} as unknown as ToolSet

describe("resolveAgent", () => {
  it("routes spotify goals to the native Spotify agent", () => {
    const a = resolveAgent("play some lofi on spotify")
    expect(a.id).toBe("spotify")
    expect(a.label).toBe("Spotify Agent")
    expect(a.provider).toBe("native")
  })

  it("routes whatsapp goals to the general automation agent while messaging is hidden", () => {
    const a = resolveAgent("send a whatsapp to Alex saying hi")
    expect(a.id).toBe("automation")
    expect(a.toolNames).toBeUndefined() // inherits the full tool set
  })

  it("falls back to the general automation agent for unmatched goals", () => {
    expect(resolveAgent("do the thing now").id).toBe("automation")
  })
})

describe("scopeTools", () => {
  it("scopes the Spotify agent to its tools plus the read-only base", () => {
    const scoped = scopeTools(allTools, resolveAgent("play lofi on spotify"))
    const keys = Object.keys(scoped)
    expect(keys).toContain("play_spotify")
    expect(keys).toContain("control_spotify")
    expect(keys).toContain("look_at_screen") // base
    expect(keys).toContain("read_file") // base
    expect(keys).not.toContain("send_whatsapp_message")
    expect(keys).not.toContain("browser_navigate")
  })

  it("passes the full tool set through unchanged for inherit-all agents", () => {
    const scoped = scopeTools(allTools, resolveAgent("send a whatsapp to Alex"))
    expect(Object.keys(scoped).sort()).toEqual(Object.keys(allTools).sort())
  })
})
