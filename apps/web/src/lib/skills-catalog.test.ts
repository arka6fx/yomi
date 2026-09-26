import { describe, expect, it } from "vitest"
import { SKILL_CATALOG, shortSchedule } from "./skills-catalog"

describe("shortSchedule", () => {
  it("shortens the backend's schedule phrases", () => {
    expect(shortSchedule("every day at 8am")).toBe("daily · 8am")
    expect(shortSchedule("every weekday at 4pm")).toBe("weekdays · 4pm")
    expect(shortSchedule("every sunday at 6pm")).toBe("sunday · 6pm")
    expect(shortSchedule("every day at 7:30am")).toBe("daily · 7:30am")
  })

  it("leaves anything else alone", () => {
    expect(shortSchedule("twice a month")).toBe("twice a month")
  })

  it("covers every routine in the catalog", () => {
    for (const skill of SKILL_CATALOG.filter((s) => s.schedule)) {
      expect(shortSchedule(skill.schedule!)).toContain(" · ")
    }
  })
})
