import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
}

let currentUser: TestUser
let offerable: any[] = []
let capacity: any = { ok: true }
let scheduleInserts: any[] = []
let decisionInserts: any[] = []
let scheduleDeletes = 0
let decisionInsertThrows = false

const CATALOG = [
  {
    dedupKey: "gmail-daily-briefing-v1",
    provider: "google",
    title: "Daily inbox briefing",
    description: "desc-a",
    requires: { telegram: true },
    spec: { schedule: "every day 9am", prompt: "prompt-a", deliverTo: ["telegram"] },
  },
  {
    dedupKey: "daily-checkin-v1",
    provider: null,
    title: "Daily check-in",
    description: "desc-b",
    requires: { telegram: true },
    spec: { schedule: "every day 5pm", prompt: "prompt-b", deliverTo: ["telegram"] },
  },
]

mock.module("@yomi/db", () => ({
  db: {
    insert: (table: any) => ({
      values: (v: any) => {
        if (table.__name === "schedules") {
          const row = { id: `sch-${scheduleInserts.length}`, ...v }
          scheduleInserts.push(row)
          return { returning: () => Promise.resolve([row]) }
        }
        if (decisionInsertThrows) {
          const chain = {
            returning: () => Promise.reject(new Error("duplicate key value violates unique constraint")),
            then: (_res: any, rej: any) =>
              Promise.reject(new Error("duplicate key value violates unique constraint")).then(_res, rej),
          }
          return chain
        }
        decisionInserts.push(v)
        const p: any = Promise.resolve()
        p.returning = () => Promise.resolve([v])
        return p
      },
    }),
    delete: () => ({
      where: () => {
        scheduleDeletes++
        return Promise.resolve()
      },
    }),
  },
  schedules: { __name: "schedules", id: {} },
  suggestionDecisions: { __name: "decisions" },
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../services/suggestions/catalog.js", () => ({
  SUGGESTION_CATALOG: CATALOG,
  findEntry: (key: string) => CATALOG.find((e) => e.dedupKey === key),
  offerableFor: async () => offerable,
}))

mock.module("../services/schedule-quota.js", () => ({
  ensureScheduleCapacity: async () => capacity,
}))

mock.module("../services/schedule-parser.js", () => ({
  validateScheduleInput: () => ({ ok: true, scheduleType: "phrase" }),
  computeNextRun: () => new Date("2026-07-08T09:00:00Z"),
}))

let suggestionsRouter: import("hono").Hono

beforeAll(async () => {
  suggestionsRouter = (await import("./suggestions.js")).suggestionsRouter
})

function app() {
  const hono = new Hono()
  hono.route("/api/suggestions", suggestionsRouter)
  return hono
}

beforeEach(() => {
  currentUser = {
    id: "user_1",
    email: "user@example.com",
    role: "user",
    plan: "pro",
    subscriptionStatus: "active",
  }
  offerable = [...CATALOG]
  capacity = { ok: true }
  scheduleInserts = []
  decisionInserts = []
  scheduleDeletes = 0
  decisionInsertThrows = false
})

describe("suggestions routes", () => {
  it("GET / maps offerable entries to the wire shape", async () => {
    const res = await app().request("/api/suggestions")
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.suggestions).toEqual([
      {
        dedupKey: "gmail-daily-briefing-v1",
        title: "Daily inbox briefing",
        description: "desc-a",
        schedulePreview: "every day 9am",
      },
      {
        dedupKey: "daily-checkin-v1",
        title: "Daily check-in",
        description: "desc-b",
        schedulePreview: "every day 5pm",
      },
    ])
  })

  it("accept creates a schedule and an accepted decision, returns scheduleId", async () => {
    const res = await app().request("/api/suggestions/gmail-daily-briefing-v1/accept", {
      method: "POST",
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.scheduleId).toBe("sch-0")
    expect(scheduleInserts[0].prompt).toBe("prompt-a")
    expect(scheduleInserts[0].deliverTo).toEqual(["telegram"])
    expect(decisionInserts[0].decision).toBe("accepted")
    expect(decisionInserts[0].scheduleId).toBe("sch-0")
    expect(decisionInserts[0].dedupKey).toBe("gmail-daily-briefing-v1")
  })

  it("accept for a non-offerable key returns 404 and inserts nothing", async () => {
    offerable = []
    const res = await app().request("/api/suggestions/gmail-daily-briefing-v1/accept", {
      method: "POST",
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as any).code).toBe("not_offerable")
    expect(scheduleInserts.length).toBe(0)
    expect(decisionInserts.length).toBe(0)
  })

  it("accept surfaces the plan gate untouched", async () => {
    capacity = {
      ok: false,
      status: 402,
      body: { error: "limit", code: "schedule_limit", upgradeUrl: "/dashboard?upgrade=true" },
    }
    const res = await app().request("/api/suggestions/gmail-daily-briefing-v1/accept", {
      method: "POST",
    })
    expect(res.status).toBe(402)
    expect(((await res.json()) as any).code).toBe("schedule_limit")
    expect(scheduleInserts.length).toBe(0)
  })

  it("duplicate accept returns 409 and removes the just-created schedule", async () => {
    decisionInsertThrows = true
    const res = await app().request("/api/suggestions/gmail-daily-briefing-v1/accept", {
      method: "POST",
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as any).code).toBe("already_decided")
    expect(scheduleDeletes).toBe(1)
  })

  it("dismiss records a dismissed decision and is idempotent", async () => {
    const res = await app().request("/api/suggestions/daily-checkin-v1/dismiss", {
      method: "POST",
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).ok).toBe(true)
    expect(decisionInserts[0].decision).toBe("dismissed")
    decisionInsertThrows = true
    const res2 = await app().request("/api/suggestions/daily-checkin-v1/dismiss", {
      method: "POST",
    })
    expect(res2.status).toBe(200)
  })

  it("dismiss of an unknown key returns 404", async () => {
    const res = await app().request("/api/suggestions/nope/dismiss", { method: "POST" })
    expect(res.status).toBe(404)
  })
})
