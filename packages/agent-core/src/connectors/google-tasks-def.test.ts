import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createTasksTools, googleTasksDef } from "./google-tasks-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body: string }[] = []

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createTasksTools({
    userId: "user_1",
    getAccessToken: async () => "tasks-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    })
    return Response.json({ id: "task_1", title: "Renew passport", status: "needsAction" })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("google tasks connector", () => {
  it("requests the read/write tasks scope, not the read-only one", () => {
    const scopes = googleTasksDef.auth.kind === "oauth2" ? googleTasksDef.auth.scopes : []
    expect(scopes).toContain("https://www.googleapis.com/auth/tasks")
    expect(scopes).not.toContain("https://www.googleapis.com/auth/tasks.readonly")
  })

  it("falls back to the default task list when none is named", async () => {
    await executeTool("tasks-listTasks", { includeCompleted: false, maxResults: 50 })
    expect(requests[0]!.url).toContain("/lists/@default/tasks")
  })

  it("hides completed tasks by default and sorts undated tasks last", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push({ url: String(input), method: "GET", body: "" })
      return Response.json({
        items: [
          { id: "b", title: "Someday", status: "needsAction" },
          { id: "a", title: "Taxes", status: "needsAction", due: "2026-08-01T00:00:00.000Z" },
        ],
      })
    }) as typeof fetch

    const res = (await executeTool("tasks-listTasks", {
      includeCompleted: false,
      maxResults: 50,
    })) as { tasks: { title: string; due?: string }[] }

    expect(requests[0]!.url).toContain("showCompleted=false")
    expect(res.tasks.map((t) => t.title)).toEqual(["Taxes", "Someday"])
    expect(res.tasks[0]!.due).toBe("2026-08-01")
  })

  it("normalises a plain due date into the RFC-3339 form Google wants", async () => {
    await executeTool("tasks-createTask", { title: "Renew passport", due: "2026-09-15" })
    const post = requests.find((r) => r.method === "POST")!
    expect(JSON.parse(post.body)).toMatchObject({
      title: "Renew passport",
      due: "2026-09-15T00:00:00.000Z",
    })
  })

  it("clears the completion timestamp when reopening a task", async () => {
    await executeTool("tasks-completeTask", { taskId: "task_1", done: false })
    const patch = requests.find((r) => r.method === "PATCH")!
    // Without completed:null Google keeps the old timestamp and the task stays done.
    expect(JSON.parse(patch.body)).toEqual({ status: "needsAction", completed: null })
  })

  it("refuses an update that changes nothing", async () => {
    const res = (await executeTool("tasks-updateTask", { taskId: "task_1" })) as { error?: string }
    expect(res.error).toContain("Nothing to update")
    expect(requests).toHaveLength(0)
  })
})
