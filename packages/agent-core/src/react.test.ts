import { describe, expect, it } from "bun:test"
import { ALLOWED_REACTIONS, createReactionTool, type ReactFn } from "./react.js"

describe("createReactionTool", () => {
  it("returns a tool with the correct shape", () => {
    const react: ReactFn = async () => {}
    const tool = createReactionTool(react)
    expect(tool).toBeDefined()
    expect(typeof tool.description).toBe("string")
    expect(tool.description).toContain("rarely")
    expect(tool.parameters).toBeDefined()
  })

  it("calls react with the model-chosen emoji", async () => {
    let calledEmoji = ""
    const react: ReactFn = async (emoji) => {
      calledEmoji = emoji
    }

    const tool = createReactionTool(react)
    const result = await tool.execute!({ emoji: "🔥" }, {} as never)

    expect(calledEmoji).toBe("🔥")
    expect(result).toEqual({ ok: true })
  })

  it("rejects an emoji outside the allowed set at the schema level", () => {
    const react: ReactFn = async () => {}
    const tool = createReactionTool(react)
    const parsed = tool.parameters.safeParse({ emoji: "🍑" })
    expect(parsed.success).toBe(false)
  })

  it("exposes the allowed reaction list", () => {
    expect(ALLOWED_REACTIONS).toContain("👍")
    expect(ALLOWED_REACTIONS.length).toBeGreaterThan(5)
  })
})
