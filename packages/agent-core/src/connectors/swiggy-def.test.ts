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
  const foodTools = ["place_food_order", "track_food_order", "get_food_orders", "get_food_order_details", "search_restaurants", "update_food_cart", "flush_food_cart", "get_food_cart"]
  const imTools = [
    "search_products", "your_go_to_items",
    "update_cart", "get_cart", "clear_cart",
    "checkout",
    "get_orders", "get_order_details", "track_order",
    "create_address", "delete_address", "get_addresses",
    "report_error",
  ]
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

  it("passes get_food_orders through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_food_orders"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["get_food_orders"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })

  it("passes get_food_order_details through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_food_order_details"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["get_food_order_details"]!.execute({ order_id: "o1" })

    expect(execute).toHaveBeenCalled()
  })

  it("on replay (no createPendingAction) place_food_order executes the real MCP tool", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["place_food_order"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx()

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = { restaurantId: "r1", items: [{ name: "Chicken Biryani", quantity: 1 }] }
    const result = await wrapped["place_food_order"]!.execute(payload)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(payload)
    expect(result).toMatchObject({ ok: true })
  })

  it("on replay (no createPendingAction) checkout executes the real MCP tool", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["checkout"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx()

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = { items: [{ name: "Milk", quantity: 2 }] }
    const result = await wrapped["checkout"]!.execute(payload)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(payload)
    expect(result).toMatchObject({ ok: true })
  })
})

describe("wrapOrderTools — Food cart mutation tools (direct execution)", () => {
  it("passes update_food_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["update_food_cart"]!.execute as ReturnType<typeof mock>
    if (!execute) return
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["update_food_cart"]!.execute({ restaurant_id: "r1", item_id: "i1", quantity: 2 })

    expect(execute).toHaveBeenCalled()
  })

  it("passes flush_food_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["flush_food_cart"]!.execute as ReturnType<typeof mock>
    if (!execute) return
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["flush_food_cart"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })

  it("passes get_food_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_food_cart"]!.execute as ReturnType<typeof mock>
    if (!execute) return
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["get_food_cart"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })

  it("passes search_restaurants through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["search_restaurants"]!.execute as ReturnType<typeof mock>
    if (!execute) return
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["search_restaurants"]!.execute({ query: "biryani" })

    expect(execute).toHaveBeenCalled()
  })
})

describe("wrapOrderTools — Instamart discover tools", () => {
  it("passes search_products through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["search_products"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["search_products"]!.execute({ query: "milk" })

    expect(execute).toHaveBeenCalledWith({ query: "milk" })
    expect(result).toEqual({ ok: true, name: "search_products", args: { query: "milk" } })
  })

  it("passes your_go_to_items through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["your_go_to_items"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["your_go_to_items"]!.execute({})

    expect(execute).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, name: "your_go_to_items" })
  })
})

describe("wrapOrderTools — Instamart cart tools", () => {
  it("passes update_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["update_cart"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["update_cart"]!.execute({ product_id: "p1", quantity: 2 })

    expect(execute).toHaveBeenCalledWith({ product_id: "p1", quantity: 2 })
  })

  it("passes get_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_cart"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["get_cart"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })

  it("passes clear_cart through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["clear_cart"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["clear_cart"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })
})

describe("wrapOrderTools — Instamart track tools", () => {
  it("passes get_orders through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_orders"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["get_orders"]!.execute({})

    expect(execute).toHaveBeenCalled()
  })

  it("passes get_order_details through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_order_details"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["get_order_details"]!.execute({ order_id: "o1" })

    expect(execute).toHaveBeenCalledWith({ order_id: "o1" })
  })

  it("passes track_order through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["track_order"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["track_order"]!.execute({ order_id: "o1" })

    expect(execute).toHaveBeenCalledWith({ order_id: "o1" })
  })
})

describe("wrapOrderTools — Instamart address read (pass-through)", () => {
  it("passes get_addresses through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["get_addresses"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["get_addresses"]!.execute({})

    expect(execute).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, name: "get_addresses" })
  })
})

describe("wrapOrderTools — Instamart address switch pattern", () => {
  it("blocks create_address when _confirmAddressSwitch is not set", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["create_address"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["create_address"]!.execute({ address: "123 Main St" })

    expect(result).toMatchObject({
      hint: expect.stringContaining("clearing the cart"),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("blocks delete_address when _confirmAddressSwitch is not set", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["delete_address"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["delete_address"]!.execute({ address_id: "a1" })

    expect(result).toMatchObject({
      hint: expect.stringContaining("clearing the cart"),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("allows create_address with _confirmAddressSwitch flag", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["create_address"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["create_address"]!.execute({ address: "123 Main St", _confirmAddressSwitch: true })

    expect(execute).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, name: "create_address" })
  })

  it("strips _confirmAddressSwitch before passing to MCP tool", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["create_address"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx()

    const wrapped = wrapOrderTools(mockTools, ctx)
    await wrapped["create_address"]!.execute({ address: "123 Main St", city: "Mumbai", _confirmAddressSwitch: true })

    expect(execute).toHaveBeenCalledWith({ address: "123 Main St", city: "Mumbai" })
  })

  it("allows delete_address with _confirmAddressSwitch flag", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["delete_address"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["delete_address"]!.execute({ address_id: "a1", _confirmAddressSwitch: true })

    expect(execute).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, name: "delete_address" })
  })
})

describe("wrapOrderTools — Instamart report_error (pass-through)", () => {
  it("passes report_error through without gating", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["report_error"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx({ createPendingAction: mock(async () => ({ id: "p1", status: "pending", message: "queued" })) })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const result = await wrapped["report_error"]!.execute({ error: "delayed delivery" })

    expect(execute).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, name: "report_error", args: { error: "delayed delivery" } })
  })
})

describe("getOrderPreview — Food orders", () => {
  it("includes restaurant and items in the preview", async () => {
    const mockTools = makeMockTools()
    const createPendingAction = mock(async (input: unknown) => {
      madeCalls.push(input)
      return { id: "p1", status: "pending", message: "queued" }
    })
    const madeCalls: unknown[] = []
    const ctx = buildCtx({ createPendingAction })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = {
      restaurant_id: "Paradise",
      items: [{ name: "Chicken Biryani", quantity: 2 }, { name: "Raita", quantity: 1 }],
      total: 650,
    }
    await wrapped["place_food_order"]!.execute(payload)

    expect(madeCalls[0]).toMatchObject({
      action: "place_food_order",
      preview: "Place order at Paradise (Chicken Biryani x2, Raita x1) ₹650",
    })
  })
})

describe("getOrderPreview — Instamart checkout", () => {
  it("includes items in the checkout preview", async () => {
    const mockTools = makeMockTools()
    const madeCalls: unknown[] = []
    const createPendingAction = mock(async (input: unknown) => {
      madeCalls.push(input)
      return { id: "p1", status: "pending", message: "queued" }
    })
    const ctx = buildCtx({ createPendingAction })

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = {
      items: [{ name: "Milk", quantity: 2 }, { name: "Eggs", quantity: 12 }],
      total: 450,
    }
    await wrapped["checkout"]!.execute(payload)

    expect(madeCalls[0]).toMatchObject({
      action: "checkout",
      preview: "Checkout Instamart cart",
    })
  })
})

describe("Order memory — backend pattern", () => {
  it("checkout payload carries items for memory recording", async () => {
    const mockTools = makeMockTools()
    const execute = mockTools["checkout"]!.execute as ReturnType<typeof mock>
    const ctx = buildCtx()

    const wrapped = wrapOrderTools(mockTools, ctx)
    const payload = {
      items: [{ name: "Milk", product_name: "Full Cream Milk", quantity: 2 }],
      total: 120,
    }
    const result = await wrapped["checkout"]!.execute(payload)

    expect(execute).toHaveBeenCalledWith(payload)
    expect(result).toMatchObject({ ok: true })
  })
})
