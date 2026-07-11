import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createCalendarTools } from "./google-calendar-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body: string }[] = []

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createCalendarTools({
    userId: "user_1",
    getAccessToken: async () => "calendar-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") })

    // The user's calendar timezone, which eventTime() looks up to anchor an
    // offset-less wall-clock time.
    if (url.includes("/users/me/settings/timezone")) {
      return Response.json({ value: "Asia/Kolkata" })
    }
    return Response.json({
      id: "evt_1",
      htmlLink: "https://calendar.google.com/event?eid=evt_1",
      conferenceData: { entryPoints: [{ uri: "https://meet.google.com/abc-defg-hij" }] },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("calendar-createEventWithMeet", () => {
  // Live failure: Google rejected the create with 400 "Missing time zone definition
  // for start time". calendar-createEvent ran its times through eventTime(), which
  // attaches the user's calendar timezone; the Meet variant hand-built
  // { dateTime } with no timeZone, so the two paths had silently drifted apart.
  it("sends a timezone with an offset-less start and end", async () => {
    await executeTool("calendar-createEventWithMeet", {
      title: "Call with Alex",
      start: "2026-07-12T16:00:00",
      end: "2026-07-12T17:00:00",
    })

    const create = requests.find((r) => r.method === "POST")
    expect(create).toBeDefined()
    expect(create!.url).toContain("conferenceDataVersion=1")

    const body = JSON.parse(create!.body) as {
      start: { dateTime: string; timeZone?: string }
      end: { dateTime: string; timeZone?: string }
    }
    expect(body.start).toEqual({ dateTime: "2026-07-12T16:00:00", timeZone: "Asia/Kolkata" })
    expect(body.end).toEqual({ dateTime: "2026-07-12T17:00:00", timeZone: "Asia/Kolkata" })
  })

  it("leaves an explicit offset alone rather than double-anchoring it", async () => {
    await executeTool("calendar-createEventWithMeet", {
      title: "Call with Alex",
      start: "2026-07-12T16:00:00+05:30",
      end: "2026-07-12T17:00:00+05:30",
    })

    const create = requests.find((r) => r.method === "POST")
    const body = JSON.parse(create!.body) as { start: { timeZone?: string } }
    expect(body.start.timeZone).toBeUndefined()
  })

  it("returns the meet link and the event link", async () => {
    const result = (await executeTool("calendar-createEventWithMeet", {
      title: "Call with Alex",
      start: "2026-07-12T16:00:00",
      end: "2026-07-12T17:00:00",
    })) as { link?: string; meetLink?: string }

    expect(result.link).toBe("https://calendar.google.com/event?eid=evt_1")
    expect(result.meetLink).toBe("https://meet.google.com/abc-defg-hij")
  })
})
