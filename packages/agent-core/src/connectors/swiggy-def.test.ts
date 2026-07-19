import { describe, expect, it, mock } from "bun:test"
import type { ToolExecutionOptions, ToolSet } from "ai"
import { SWIGGY_MCP_SERVERS, wrapOrderTools } from "./swiggy-def.js"
import type { ConnectorContext } from "./connector-def.js"

function makeMockTools(extra?: Record<string, ToolSet[string]>): ToolSet {
  const dineoutReads = [
    "search_restaurants_dineout",
    "get_restaurant_details",
    "get_saved_locations",
    "get_booking_status",
    "report_error",
  ]
  const dineoutWrites = ["get_available_slots", "create_cart"]
  const foodTools = ["place_food_order", "track_food_order", "get_food_orders", "get_food_order_details"]
  const imTools = ["checkout", "get_orders", "get_order_details", "track_order"]
  const tools: ToolSet = {}

  for (const name of [...dineoutReads, ...dineoutWrites, ...foodTools, ...imTools]) {
    tools[name] = {
      description: `Mock ${name}`,
      parameters: { type: "object", properties: {} },
      execute: mock(async (args: unknown, _options?: ToolExecutionOptions) => ({ ok: true, name, args })),
    }
  }

  tools["book_table"] = {
    description: "Book a Dineout table",
    parameters: { type: "object", properties: {} },
    execute: mock(async (args: unknown, _options?: ToolExecutionOptions) => ({ ok: true, bookingId: "b1", name: "book_table", args })),
  }

  if (extra) Object.assign(tools, extra)
  return tools
}

function buildCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    userId: "user_1",
    getAccessToken: async () => "swiggy-token",
    ...overrides,
  }
}

describe("SWIGGY_MCP_SERVERS", () => {
  it("includes the dineout server", () => {
    const ids = SWIGGY_MCP_SERVERS.map((s) => s.id)
    expect(ids).toContain("dineout")
  })

  it("includes food and im servers", () => {
    const ids = SWIGGY_MCP_SERVERS.map((s) => s.id)
    expect(ids).toContain("food")
    expect(ids).toContain("im")
  })

  it("specifies the correct dineout URL", () => {
    const dineout = SWIGGY_MCP_SERVERS.find((s) => s.id === "dineout")
    expect(dineout?.url).toBe("https://mcp.swiggy.com/dineout")
  })
})

describe("wrapOrderTools — Dineout read pass-through", () => {
  it("passes search_restaurants_dineout through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["search_restaurants_dineout"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["search_restaurants_dineout"]!.execute({ query: "Italian" })

    expect(execute).toHaveBeenCalledWith({ query: "Italian" })
    expect(result).toEqual({ ok: true, name: "search_restaurants_dineout", args: { query: "Italian" } })
  })

  it("passes get_restaurant_details through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_restaurant_details"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["get_restaurant_details"]!.execute({ restaurant_id: "r1" })

    expect(execute).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, name: "get_restaurant_details", args: { restaurant_id: "r1" } })
  })

  it("passes get_saved_locations through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_saved_locations"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["get_saved_locations"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })

  it("passes get_booking_status through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_booking_status"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["get_booking_status"]!.execute({ booking_id: "b1" })

    expect(execute).toHaveBeenCalled()
  })

  it("passes report_error through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["report_error"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["report_error"]!.execute({ error: "test" })

    expect(execute).toHaveBeenCalled()
  })
})

describe("wrapOrderTools — Dineout write tools (non-order pass-through)", () => {
  it("passes get_available_slots through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_available_slots"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["get_available_slots"]!.execute({ restaurant_id: "r1", date: "2026-07-20", party_size: 2 })

    expect(execute).toHaveBeenCalled()
  })

  it("passes create_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["create_cart"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["create_cart"]!.execute({ restaurant_id: "r1" })

    expect(execute).toHaveBeenCalled()
  })
})

describe("wrapOrderTools — book_table gateWrite", () => {
  it("routes book_table through createPendingAction with correct metadata", async () => {
    const mockTools = makeMockTools()
    const madeCalls: unknown[] = []
    const createPendingAction = mock(async (input: unknown) => {
      madeCalls.push(input)
      return { id: "p1", status: "pending", message: "queued" }
    })
    const ctx = buildCtx({ createPendingAction })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = { restaurant_id: "r1", date_time: "2026-07-20T20:00", party_size: 2, isFree: true }
    const result = await wrapped["book_table"]!.execute(payload)

    expect(createPendingAction).toHaveBeenCalledTimes(1)
    expect(madeCalls[0]).toMatchObject({
      connector: "swiggy",
      action: "book_table",
      risk: "paid",
      payload,
    })
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("does not call the underlying MCP execute when gated", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["book_table"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["book_table"]!.execute({ restaurant_id: "r1", isFree: true })

    expect(execute).not.toHaveBeenCalled()
  })

  it("rejects non-free reservations with an error", async () => {
    const mockTools = makeMockTools()
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["book_table"]!.execute({ restaurant_id: "r1", isFree: false })

    expect(result).toMatchObject({
      error: expect.stringContaining("free"),
    })
  })

  it("rejects reservations without isFree", async () => {
    const mockTools = makeMockTools()
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["book_table"]!.execute({ restaurant_id: "r1" })

    expect(result).toMatchObject({
      error: expect.stringContaining("free"),
    })
  })

  it("accepts is_free (snake_case variant) as free reservation", async () => {
    const mockTools = makeMockTools()
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["book_table"]!.execute({ restaurant_id: "r1", is_free: true })

    expect(result).not.toHaveProperty("error")
  })
})

describe("wrapOrderTools — approval replay", () => {
  it("on replay (no createPendingAction) book_table executes the real MCP tool", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["book_table"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx()

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = { restaurant_id: "r1", date_time: "2026-07-20T20:00", party_size: 2, isFree: true }
    const result = await wrapped["book_table"]!.execute(payload)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(payload)
    expect(result).toMatchObject({ ok: true, bookingId: "b1" })
  })
})

describe("wrapOrderTools — Food/Instamart order tools", () => {
  it("gates place_food_order through createPendingAction", async () => {
    const mockTools = makeMockTools()
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["place_food_order"]!.execute({})

    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("gates checkout through createPendingAction", async () => {
    const mockTools = makeMockTools()
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["checkout"]!.execute({})

    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("passes track_food_order through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["track_food_order"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["track_food_order"]!.execute({ order_id: "o1" })

    expect(execute).toHaveBeenCalled()
  })
})
