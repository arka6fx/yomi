import { afterEach, describe, expect, it, setSystemTime } from "bun:test"
import { buildSystemWithContext } from "./run.js"

afterEach(() => {
  setSystemTime()
})

describe("today in the system prompt", () => {
  // The box runs UTC. At 02:49 IST on 12 July it is still 21:19 UTC on the 11th, so
  // an unzoned prompt told the model "today is July 11" while the user's phone said
  // the 12th — and "schedule a call tomorrow at 4pm" booked the 12th, i.e. today.
  // Wrong every evening once the UTC date lags the user's.
  const lateNightIst = new Date("2026-07-11T21:19:00Z") // 02:49 on 12 July in Kolkata

  it("uses the user's timezone for the date, not the server's", () => {
    setSystemTime(lateNightIst)
    const prompt = buildSystemWithContext("", "", undefined, [], null, undefined, "Asia/Kolkata")

    expect(prompt).toContain("July 12, 2026")
    expect(prompt).not.toContain("July 11, 2026")
    expect(prompt).toContain("Asia/Kolkata")
  })

  it("tells the model to resolve relative times against that zone", () => {
    setSystemTime(lateNightIst)
    const prompt = buildSystemWithContext("", "", undefined, [], null, undefined, "Asia/Kolkata")

    expect(prompt).toContain("never against UTC")
  })

  it("falls back to the server date when the timezone is unknown", () => {
    setSystemTime(lateNightIst)
    const prompt = buildSystemWithContext("", "", undefined, [], null, undefined, null)

    // No zone to anchor to — say nothing about one rather than assert a wrong one.
    expect(prompt).toContain("Today is")
    expect(prompt).not.toContain("never against UTC")
  })

  it("does not shift the date for a user already on the server's date", () => {
    setSystemTime(new Date("2026-07-12T10:00:00Z")) // 15:30 IST, same day both ways
    const prompt = buildSystemWithContext("", "", undefined, [], null, undefined, "Asia/Kolkata")

    expect(prompt).toContain("July 12, 2026")
  })
})
