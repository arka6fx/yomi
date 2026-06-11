import { describe, expect, it } from "bun:test"
import { createMessagingTools } from "./messaging.js"

describe("messaging tools (stubbed)", () => {
  it("returns empty tool set", () => {
    const tools = createMessagingTools()
    expect(Object.keys(tools)).toHaveLength(0)
  })
})
