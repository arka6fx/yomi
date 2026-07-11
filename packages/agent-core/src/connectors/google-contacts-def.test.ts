import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createContactsTools, googleContactsDef, rankCandidates } from "./google-contacts-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body: string }[] = []

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createContactsTools({
    userId: "user_1",
    getAccessToken: async () => "people-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

function person(name: string, email: string) {
  return { person: { resourceName: `people/${email}`, names: [{ displayName: name }], emailAddresses: [{ value: email }] } }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  requests = []
})

describe("rankCandidates", () => {
  it("prefers an exact name match, then a saved contact over an inferred one", () => {
    const ranked = rankCandidates(
      [
        { name: "Alexandra Reid", emails: ["ar@x.com"], phones: [], source: "contacts" },
        { name: "Alex", emails: ["alex@other.com"], phones: [], source: "other" },
        { name: "Alex", emails: ["alex@saved.com"], phones: [], source: "contacts" },
      ],
      "Alex",
    )
    expect(ranked.map((c) => c.emails[0])).toEqual([
      "alex@saved.com",
      "alex@other.com",
      "ar@x.com",
    ])
  })
})

describe("contacts-resolveRecipient", () => {
  it("searches saved, other, and directory contacts and dedupes on email", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push({ url, method: "GET", body: "" })
      if (url.includes("/people:searchContacts")) return Response.json({ results: [person("Alex Kim", "alex@kim.com")] })
      // Same human, already known from mail history — must not appear twice.
      if (url.includes("/otherContacts:search")) return Response.json({ results: [person("Alex Kim", "alex@kim.com")] })
      return Response.json({ results: [] })
    }) as typeof fetch

    const res = (await executeTool("contacts-resolveRecipient", { name: "Alex" })) as {
      count: number
      resolved?: string
    }

    expect(requests.some((r) => r.url.includes("people:searchContacts"))).toBe(true)
    expect(requests.some((r) => r.url.includes("otherContacts:search"))).toBe(true)
    expect(requests.some((r) => r.url.includes("searchDirectoryPeople"))).toBe(true)
    expect(res.count).toBe(1)
    expect(res.resolved).toBe("alex@kim.com")
  })

  it("still resolves when the directory search fails (personal Gmail has no directory)", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/people:searchContacts")) return Response.json({ results: [person("Priya", "priya@x.com")] })
      if (url.includes("searchDirectoryPeople")) return new Response("no directory", { status: 403 })
      return Response.json({ results: [] })
    }) as typeof fetch

    const res = (await executeTool("contacts-resolveRecipient", { name: "Priya" })) as {
      resolved?: string
    }
    expect(res.resolved).toBe("priya@x.com")
  })

  it("does not resolve when several people match — the agent must ask", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/people:searchContacts")) {
        return Response.json({ results: [person("Alex Kim", "a@k.com"), person("Alex Roy", "a@r.com")] })
      }
      return Response.json({ results: [] })
    }) as typeof fetch

    const res = (await executeTool("contacts-resolveRecipient", { name: "Alex" })) as {
      count: number
      resolved?: string
      message: string
    }
    expect(res.count).toBe(2)
    expect(res.resolved).toBeUndefined()
    expect(res.message).toContain("ask the user")
  })

  it("reports no match instead of inventing an address", async () => {
    globalThis.fetch = (async () => Response.json({ results: [] })) as typeof fetch
    const res = (await executeTool("contacts-resolveRecipient", { name: "Nobody" })) as {
      matches: unknown[]
      message: string
    }
    expect(res.matches).toEqual([])
    expect(res.message).toContain("Ask the user")
  })
})

describe("contacts write", () => {
  it("sends the current etag on update — Google rejects a stale write", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      })
      if (url.includes("updateContact")) return Response.json({ resourceName: "people/c1" })
      return Response.json({ resourceName: "people/c1", etag: "etag-abc" })
    }) as typeof fetch

    await executeTool("contacts-updateContact", { contactId: "people/c1", email: "new@x.com" })
    const patch = requests.find((r) => r.method === "PATCH")!
    expect(patch.url).toContain("updatePersonFields=emailAddresses")
    expect(JSON.parse(patch.body)).toMatchObject({ etag: "etag-abc" })
  })
})

describe("scopes", () => {
  it("requests contacts write plus other-contacts and directory reads", () => {
    const scopes = googleContactsDef.auth.kind === "oauth2" ? googleContactsDef.auth.scopes : []
    expect(scopes).toContain("https://www.googleapis.com/auth/contacts")
    // contacts alone does NOT cover people the user emailed but never saved.
    expect(scopes).toContain("https://www.googleapis.com/auth/contacts.other.readonly")
    expect(scopes).toContain("https://www.googleapis.com/auth/directory.readonly")
  })
})
