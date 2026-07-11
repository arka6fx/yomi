import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createMeetTools, googleMeetDef } from "./google-meet-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body: string }[] = []

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createMeetTools({
    userId: "user_1",
    getAccessToken: async () => "meet-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("meet-updateSpaceSettings", () => {
  // "Make it open to anyone with the link" minted a BRAND NEW space, because no tool
  // could edit an existing one — so the link the user had already shared kept its old
  // access, and we were requesting meetings.space.settings ("Edit ... settings") with
  // nothing that edits anything.
  function patchFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      })
      return Response.json({
        name: "spaces/abc123",
        meetingUri: "https://meet.google.com/mex-ifym-mfn",
        config: { accessType: "OPEN" },
      })
    }) as typeof fetch
  }

  it("patches the existing space instead of creating a new one", async () => {
    patchFetch()
    const result = (await executeTool("meet-updateSpaceSettings", {
      spaceId: "spaces/abc123",
      accessType: "OPEN",
    })) as { accessType?: string; link?: string }

    expect(requests).toHaveLength(1)
    const req = requests[0]!
    expect(req.method).toBe("PATCH")
    expect(req.url).toContain("/spaces/abc123")
    expect(req.url).toContain("updateMask=config.accessType")
    expect(JSON.parse(req.body)).toEqual({ config: { accessType: "OPEN" } })
    // The link the user already shared must survive the change.
    expect(result.link).toBe("https://meet.google.com/mex-ifym-mfn")
    expect(result.accessType).toBe("OPEN")
  })

  it("accepts a bare meeting code as well as a spaces/ id", async () => {
    patchFetch()
    await executeTool("meet-updateSpaceSettings", {
      spaceId: "mex-ifym-mfn",
      accessType: "RESTRICTED",
    })
    expect(requests[0]?.url).toContain("/spaces/mex-ifym-mfn")
  })
})

describe("google meet connector", () => {
  it("requests both the created and readonly meeting scopes", () => {
    const scopes = googleMeetDef.auth.kind === "oauth2" ? googleMeetDef.auth.scopes : []
    expect(scopes).toContain("https://www.googleapis.com/auth/meetings.space.created")
    expect(scopes).toContain("https://www.googleapis.com/auth/meetings.space.readonly")
  })

  it("creates a space and returns the shareable link", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      })
      return Response.json({
        name: "spaces/abc",
        meetingUri: "https://meet.google.com/abc-defg-hij",
        meetingCode: "abc-defg-hij",
      })
    }) as typeof fetch

    const res = (await executeTool("meet-createSpace", { accessType: "TRUSTED" })) as {
      ok: boolean
      link: string
    }
    expect(res.ok).toBe(true)
    expect(res.link).toBe("https://meet.google.com/abc-defg-hij")
    expect(JSON.parse(requests[0]!.body)).toEqual({ config: { accessType: "TRUSTED" } })
  })

  it("translates the same-app 403 into the workflow that actually works", async () => {
    globalThis.fetch = (async () =>
      new Response("PERMISSION_DENIED", { status: 403 })) as typeof fetch

    const res = (await executeTool("meet-endActiveConference", { space: "spaces/xyz" })) as {
      error: string
      hint?: string
    }
    expect(res.error).toContain("only lets an app manage the meeting spaces it created")
    expect(res.hint).toContain("meet-listConferenceRecords")
  })

  it("explains an absent transcript instead of erroring", async () => {
    globalThis.fetch = (async () => Response.json({ transcripts: [] })) as typeof fetch

    const res = (await executeTool("meet-getTranscript", {
      conferenceRecordId: "conferenceRecords/1",
      maxEntries: 200,
    })) as { entries: unknown[]; message: string }

    expect(res.entries).toEqual([])
    expect(res.message).toContain("paid Google Workspace plan")
  })

  it("returns transcript entries with speaker and text", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/transcripts")) {
        return Response.json({ transcripts: [{ name: "conferenceRecords/1/transcripts/t1" }] })
      }
      return Response.json({
        transcriptEntries: [
          { participant: "participants/p1", text: "Let's ship on Friday.", startTime: "2026-07-11T10:00:00Z" },
        ],
      })
    }) as typeof fetch

    const res = (await executeTool("meet-getTranscript", {
      conferenceRecordId: "conferenceRecords/1",
      maxEntries: 200,
    })) as { count: number; entries: { text: string }[] }

    expect(res.count).toBe(1)
    expect(res.entries[0]!.text).toBe("Let's ship on Friday.")
  })

  it("accepts a bare conference record id and normalises it", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push({ url: String(input), method: "GET", body: "" })
      if (String(input).includes("/participants")) return Response.json({ participants: [] })
      return Response.json({ name: "conferenceRecords/abc" })
    }) as typeof fetch

    await executeTool("meet-getConferenceRecord", { conferenceRecordId: "abc" })
    expect(requests[0]!.url).toContain("/v2/conferenceRecords/abc")
  })
})
