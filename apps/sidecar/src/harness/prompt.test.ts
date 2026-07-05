import { describe, expect, it } from "bun:test"
import { buildAgentPrompt, buildFastPrompt, type FastPromptOptions } from "./prompt.js"
import { loadMemoryContext } from "../memory/subsystem.js"

const defaultOpts: FastPromptOptions = { text: "hello", tts: false }

describe("prompt memory injection", () => {
  it("includes memory summary and index when provided", () => {
    const prompt = buildFastPrompt({
      ...defaultOpts,
      yomiMd: "User likes direct answers.",
      memorySummary: "- Arkady is building Yomi.",
      memoryIndex: "sessions/2026-05-25-dev.md - memory work",
      recentSession: "User: remember my project\nAssistant: It is Yomi.",
    })

    expect(prompt).toContain("<memory>")
    expect(prompt).toContain("Arkady is building Yomi")
    expect(prompt).toContain("memory work")
    expect(prompt).toContain("<recent_chat>")
    expect(prompt).toContain("remember my project")
  })

  it("instructs responses to render final answers in blocks", () => {
    const prompt = buildFastPrompt(defaultOpts)

    expect(prompt).toContain("<answer_format>")
    expect(prompt).toContain("```answer")
    expect(prompt).toContain("For coding or algorithm problems")
    expect(prompt).toContain("Format applications and letters properly")
    expect(prompt).toContain("Format biographies and long explanations")
  })

  it("includes the default agent soul in fast and agent prompts", () => {
    const fastPrompt = buildFastPrompt(defaultOpts)
    const agentPrompt = buildAgentPrompt({})

    expect(fastPrompt).toContain("<agent_soul>")
    expect(fastPrompt).toContain("You are Yomi: sharp, warm, and practical.")
    expect(agentPrompt).toContain("<agent_soul>")
    expect(agentPrompt).toContain("Do not fake access, results, files, memories, or connector data")
  })

  it("uses a provided soul override", () => {
    const prompt = buildFastPrompt({ ...defaultOpts, soulMd: "Use terse answers and dry humor." })

    expect(prompt).toContain("<agent_soul>\nUse terse answers and dry humor.\n</agent_soul>")
    expect(prompt).not.toContain("You are Yomi: sharp, warm, and practical.")
  })

  it("returns cloud memory fields and recent session history", async () => {
    const ctx = await loadMemoryContext("memory")

    expect(ctx.memorySummary).toBe("")
    expect(ctx.memoryIndex).toBe("")
    expect(ctx.localMemory).toBe("# Long-Term Memory\n\n")
    expect(typeof ctx.recentSession).toBe("string")
  })
})
