import { describe, expect, it } from "bun:test"
import { decideSoulOnboarding, ASK_SOUL_MESSAGE } from "./soul.js"

describe("decideSoulOnboarding", () => {
  it("asks on first contact and moves to awaiting", () => {
    const d = decideSoulOnboarding("unprompted", "hi there")
    expect(d.reply).toBe(ASK_SOUL_MESSAGE)
    expect(d).toMatchObject({ next: "awaiting" })
    // first message is NOT consumed as an answer — no soul set
    expect("agentSoul" in d).toBe(false)
  })

  it("stores a custom soul when the awaited reply is long enough", () => {
    const d = decideSoulOnboarding("awaiting", "Be playful, concise, and a little sarcastic.")
    expect(d).toMatchObject({
      next: "done",
      agentSoul: "Be playful, concise, and a little sarcastic.",
    })
    expect(d.reply).toContain("working style")
  })

  it("uses the default (null soul) when the user says default/skip", () => {
    for (const answer of ["default", "Default", "skip", "use the default", "built-in", "no"]) {
      const d = decideSoulOnboarding("awaiting", answer)
      expect(d).toMatchObject({ next: "done", agentSoul: null })
    }
  })

  it("re-asks when the awaited reply is too short to be a style guide", () => {
    const d = decideSoulOnboarding("awaiting", "ok")
    expect(d.reply).toBe(ASK_SOUL_MESSAGE)
    expect(d).toMatchObject({ next: "awaiting" })
    expect("agentSoul" in d).toBe(false)
  })

  it("truncates an overly long soul to 2000 chars", () => {
    const long = "x".repeat(5000)
    const d = decideSoulOnboarding("awaiting", long)
    expect(d).toMatchObject({ next: "done" })
    if ("agentSoul" in d) expect(d.agentSoul?.length).toBe(2000)
  })

  it("proceeds (no reply) once onboarding is done", () => {
    expect(decideSoulOnboarding("done", "anything")).toEqual({ reply: null })
  })
})
