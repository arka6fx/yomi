import { beforeEach, describe, expect, it, mock } from "bun:test"

type InsertCall = { values: Record<string, unknown> }
const insertCalls: InsertCall[] = []
let failNextInsert = false

mock.module("@yomi/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (failNextInsert) return Promise.reject(new Error("db down"))
          insertCalls.push({ values })
          return Promise.resolve()
        },
      }),
    }),
  },
  aiUsageEvents: { requestId: "request_id" },
}))

const { recordAiUsage, sanitizeTelemetryMetadata } = await import("./ai-telemetry.js")

beforeEach(() => {
  insertCalls.length = 0
  failNextInsert = false
})

describe("sanitizeTelemetryMetadata", () => {
  it("strips content-shaped keys", () => {
    const out = sanitizeTelemetryMetadata({
      prompt: "secret prompt",
      messages: [],
      content: "hi",
      text: "hi",
      transcript: "hi",
      screenshot: "b64",
      image: "b64",
      audio: "b64",
      payload: {},
      latencyMs: 120,
      toolCalls: 3,
    })
    expect(out).toEqual({ latencyMs: 120, toolCalls: 3 })
  })

  it("returns null for empty/undefined input", () => {
    expect(sanitizeTelemetryMetadata(undefined)).toBeNull()
    expect(sanitizeTelemetryMetadata({})).toBeNull()
    expect(sanitizeTelemetryMetadata({ prompt: "x" })).toBeNull()
  })
})

describe("recordAiUsage", () => {
  it("inserts a completed row with sanitized metadata and clamped ints", async () => {
    await recordAiUsage({
      userId: "u1",
      requestId: "req-1",
      endpoint: "sidecar.fast",
      surface: "desktop",
      route: "fast",
      model: "gpt-4.1-mini",
      inputTokens: 120.9,
      outputTokens: -5,
      latencyMs: 900,
      status: "done",
      metadata: { prompt: "never store me", latencyMs: 900 },
    })
    expect(insertCalls.length).toBe(1)
    const v = insertCalls[0]!.values
    expect(v["requestId"]).toBe("req-1")
    expect(v["inputTokens"]).toBe(120)
    expect(v["outputTokens"]).toBe(0)
    expect(v["status"]).toBe("done")
    expect((v["metadata"] as Record<string, unknown>)["prompt"]).toBeUndefined()
    expect(v["completedAt"]).toBeInstanceOf(Date)
  })

  it("never throws when the insert fails", async () => {
    failNextInsert = true
    await expect(
      recordAiUsage({
        userId: "u1",
        requestId: "req-2",
        endpoint: "backend.agent",
        surface: "telegram",
        status: "done",
      }),
    ).resolves.toBeUndefined()
  })
})
