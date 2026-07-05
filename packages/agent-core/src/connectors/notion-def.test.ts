import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createNotionTools } from "./notion-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body?: unknown }[] = []

function tools() {
  return createNotionTools({
    userId: "user_1",
    getAccessToken: async () => "notion-token",
  })
}

function executeTool(name: string, args: Record<string, unknown>) {
  const tool = tools()[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    if (url.includes("/databases/db_1") && !url.includes("/query")) {
      return Response.json({
        properties: { Task: { type: "title" }, Notes: { type: "rich_text" } },
      })
    }
    if (url.includes("/databases/db_1/query")) {
      return Response.json({ results: [] })
    }
    if (url.endsWith("/pages")) {
      return Response.json({ id: "page_1", url: "https://notion.so/page_1" })
    }
    if (url.includes("/blocks/page_1/children")) {
      return Response.json({ results: [], has_more: false })
    }
    return Response.json({})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("Notion connector", () => {
  it("blocks write tools until the user confirms", async () => {
    const result = (await executeTool("notion-appendContent", {
      pageId: "page_1",
      content: "hello",
    })) as { needsConfirmation?: boolean; error?: string }

    expect(result.needsConfirmation).toBe(true)
    expect(result.error).toInclude("confirmed=true")
    expect(requests).toHaveLength(0)
  })

  it("discovers database title property instead of assuming Name", async () => {
    await executeTool("notion-queryDatabase", {
      databaseId: "db_1",
      filter: "urgent",
      limit: 5,
    })

    const query = requests.find((r) => r.url.includes("/databases/db_1/query"))
    expect(query?.body).toEqual({
      page_size: 5,
      filter: { property: "Task", title: { contains: "urgent" } },
    })
  })

  it("uses discovered title property when creating database entries", async () => {
    await executeTool("notion-createDatabaseEntry", {
      databaseId: "db_1",
      title: "Ship Telegram fix",
      confirmed: true,
    })

    const create = requests.find((r) => r.url.endsWith("/pages"))
    expect(create?.body).toEqual({
      parent: { database_id: "db_1" },
      properties: { Task: { title: [{ text: { content: "Ship Telegram fix" } }] } },
    })
  })
})
