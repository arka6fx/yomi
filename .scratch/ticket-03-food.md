## Parent

#62 — Swiggy MCP Connector

## What to build

Connect to `mcp.swiggy.com/food` and expose all 14 Food MCP tools in Yomi's
agent loop. Users can discover restaurants, browse menus, build a cart, apply
coupons, and place orders with Telegram approval. Order tracking works. Order
memory is written after successful placements.

Specifically:

- **Lazy connection to food server** — on the first tool call targeting a Food
  tool, lazily connect `MCPServerStreamableHttp("mcp.swiggy.com/food")` using
  the shared MCP auth provider from ticket #2.
- **Tool discovery** — after connection, call `tools/list` and merge the
  resulting Food tools into `getAllDefTools()`. Tool names are namespaced
  (they come from Swiggy as `search_restaurants`, `update_food_cart`, etc.).
- **GateWrite wrapping** — the order-placing tool (`place_food_order`) is
  wrapped with `gateWrite` so the user must approve the order in Telegram
  before it executes. Cart mutation tools (`update_food_cart`,
  `flush_food_cart`) execute directly.
- **Multi-turn cart handling** — the agent is instructed to call
  `get_food_cart` at the start of every turn that touches cart state, per the
  "refresh at turn boundary" pattern.
- **Order tracking** — `track_food_order`, `get_food_orders`,
  `get_food_order_details` work as read-only tools.
- **Order memory** — after a successful `place_food_order`, write a
  `memory_entries` row with `kind = "swiggy_order"` recording restaurant,
  items summary, time-of-day, and day-of-week.
- **Error handling** — `report_error` tool is exposed for user-side error
  reporting.

## Acceptance criteria

- [ ] User says "find biryani restaurants" in Telegram → agent returns results
  from `search_restaurants`
- [ ] User says "show me the menu of restaurant X" → agent returns menu items
  with prices
- [ ] User says "add chicken biryani to cart" → agent calls `update_food_cart`
  and confirms
- [ ] User says "place the order" → agent sends Telegram approval prompt with
  order summary
- [ ] User approves → `place_food_order` executes, order placed
- [ ] User rejects → cart is flushed, no order placed
- [ ] User says "track my order" → agent returns real-time delivery status
- [ ] Order memory entry is created after successful order
- [ ] Multi-turn cart works: add item → change quantity → place order (all
  within same conversation, cart state preserved across turns)
- [ ] All 14 Food tools are callable
- [ ] Tests: read-only tool execution, gateWrite interception, order memory
  writing, multi-turn cart

## Blocked by

- [#64](https://github.com/arka6fx/yomi/issues/64) — Swiggy auth + connector linking
