## Parent

#62 — Swiggy MCP Connector

## What to build

Connect to `mcp.swiggy.com/dineout` and expose all 8 Dineout MCP tools. Users
can search restaurants for dining out, check table availability, and book
tables with Telegram approval. Booking status checks work. Order memory is
written after successful bookings.

Specifically:

- **Lazy connection to Dineout server** — on the first tool call targeting a
  Dineout tool, lazily connect
  `MCPServerStreamableHttp("mcp.swiggy.com/dineout")`.
- **Full Dineout tool set**: `search_restaurants_dineout`,
  `get_restaurant_details`, `get_saved_locations` (find);
  `get_available_slots`, `create_cart`, `book_table` (reserve);
  `get_booking_status` (manage); `report_error` (support).
- **GateWrite on booking** — `book_table` is wrapped with `gateWrite`
  requiring Telegram approval. Only free reservations are supported (Swiggy
  constraint — `isFree=true`).
- **Order memory** — after successful `book_table`, write a `memory_entries`
  row with `kind = "swiggy_order"` recording restaurant, date/time, party
  size, time-of-day, and day-of-week.

## Acceptance criteria

- [ ] User says "find Italian restaurants near me" → agent returns Dineout
  restaurant results
- [ ] User says "show me details for restaurant X" → agent returns ratings,
  deals, timings, address
- [ ] User says "check availability for 2 at 8pm on Saturday" → agent
  returns available time slots
- [ ] User says "book the table" → agent sends Telegram approval prompt with
  booking details
- [ ] User approves → `book_table` executes, reservation confirmed
- [ ] User says "what's my booking status" → agent returns current booking
  details
- [ ] Order memory entry is created after successful booking
- [ ] All 8 Dineout tools are callable
- [ ] Tests: Dineout tool execution, gateWrite on booking, order memory

## Blocked by

- [#64](https://github.com/arka6fx/yomi/issues/64) — Swiggy auth + connector linking
