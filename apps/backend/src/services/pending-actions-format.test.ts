import { describe, expect, it } from "bun:test"
import { formatActionResult, isErrorResult } from "./pending-actions.js"

describe("isErrorResult", () => {
  // Connector tools do not throw when they fail — they RETURN { error }. Treating
  // that as success reported a Google Calendar event that was never created as
  // "Approved and executed. Done: Create calendar event with Meet".
  it("recognises a returned error", () => {
    expect(isErrorResult({ error: "Calendar API 400: bad request" })).toBe(true)
    expect(isErrorResult({ ok: false, error: "boom" })).toBe(true)
  })

  it("does not treat a successful result as an error", () => {
    expect(isErrorResult({ ok: true, message: "Event created." })).toBe(false)
    expect(isErrorResult({ message: "Done." })).toBe(false)
    expect(isErrorResult(undefined)).toBe(false)
  })
})

describe("formatActionResult", () => {
  it("surfaces the error instead of the success fallback", () => {
    const text = formatActionResult(
      { error: "Calendar API returned 403: insufficient permissions" },
      "Done: Create calendar event",
    )

    expect(text).toContain("That didn't work")
    expect(text).toContain("403")
    // The fallback claimed success — it must never appear for a failed action.
    expect(text).not.toContain("Done: Create calendar event")
  })

  it("includes the hint when the tool offers one", () => {
    const text = formatActionResult(
      {
        error: "Google Meet only manages spaces it created",
        hint: "Use meet-createSpace instead.",
      },
      "Done: x",
    )
    expect(text).toContain("Use meet-createSpace instead.")
  })

  it("still formats a successful result with its links", () => {
    const text = formatActionResult(
      {
        ok: true,
        message: "Event created.",
        link: "https://calendar.google.com/event?eid=abc",
        meetLink: "https://meet.google.com/abc-defg-hij",
      },
      "Done: x",
    )

    expect(text).toContain("Event created.")
    expect(text).toContain("https://calendar.google.com/event?eid=abc")
    expect(text).toContain("https://meet.google.com/abc-defg-hij")
  })

  it("falls back only when there is no message and no error", () => {
    expect(formatActionResult({}, "Done: Archive email")).toBe("Done: Archive email")
  })
})
