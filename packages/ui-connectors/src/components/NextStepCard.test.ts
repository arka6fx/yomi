import { describe, expect, it } from "bun:test"
import { pickNextStep } from "./NextStepCard.js"

describe("pickNextStep", () => {
  it("returns the first unconnected suggestion in priority order", () => {
    const result = pickNextStep([])
    expect(result?.id).toBe("google-calendar")
  })

  it("skips connected entries and returns the next one in priority order", () => {
    const result = pickNextStep(["google-calendar", "google-drive"])
    expect(result?.id).toBe("slack")
  })

  it("returns null once every priority entry is connected", () => {
    const result = pickNextStep([
      "google-calendar",
      "google-drive",
      "slack",
      "notion",
      "github",
      "google-tasks",
      "linear",
    ])
    expect(result).toBeNull()
  })

  it("ignores connected ids that aren't on the priority list", () => {
    const result = pickNextStep(["gmail", "trello", "figma"])
    expect(result?.id).toBe("google-calendar")
  })
})
