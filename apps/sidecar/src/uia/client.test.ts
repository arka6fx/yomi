import { describe, expect, it } from "bun:test"
import type { UiaElement } from "@yomi/shared"
import { matchElement } from "./client.js"

function el(over: Partial<UiaElement>): UiaElement {
  return {
    ref: "w1e1",
    role: "Button",
    name: "",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    patterns: [],
    enabled: true,
    ...over,
  }
}

describe("matchElement (re-resolve a stale ref against a fresh snapshot)", () => {
  it("matches by automationId first", () => {
    const prev = el({ ref: "w1e5", automationId: "sendBtn", name: "Different now", role: "Button" })
    const fresh = [el({ ref: "w2e3", automationId: "sendBtn", name: "Send", role: "Button" })]
    expect(matchElement(prev, fresh)?.ref).toBe("w2e3")
  })

  it("falls back to exact name + role when automationId is absent", () => {
    const prev = el({ ref: "w1e5", name: "Play", role: "Button" })
    const fresh = [
      el({ ref: "w2e1", name: "Play", role: "Text" }), // wrong role
      el({ ref: "w2e2", name: "Play", role: "Button" }),
    ]
    expect(matchElement(prev, fresh)?.ref).toBe("w2e2")
  })

  it("falls back to fuzzy name (substring) within the same role", () => {
    const prev = el({ ref: "w1e5", name: "Savera", role: "ListItem" })
    const fresh = [el({ ref: "w2e9", name: "Savera by Anubha Bajaj", role: "ListItem" })]
    expect(matchElement(prev, fresh)?.ref).toBe("w2e9")
  })

  it("returns null when nothing matches", () => {
    const prev = el({ ref: "w1e5", name: "Send", role: "Button" })
    const fresh = [el({ ref: "w2e1", name: "Cancel", role: "Button" })]
    expect(matchElement(prev, fresh)).toBeNull()
  })
})
