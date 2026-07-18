## Parent

#62 — Swiggy MCP Connector

## What to build

Connect to `mcp.swiggy.com/im` and expose all 13 Instamart MCP tools. Users
can search for products, manage delivery addresses, build a cart, and place
grocery orders with Telegram approval. Order memory is written after
successful checkouts.

Specifically:

- **Lazy connection to Instamart server** — on the first tool call targeting an
  Instamart tool, lazily connect
  `MCPServerStreamableHttp("mcp.swiggy.com/im")`.
- **Full Instamart tool set**: `search_products`, `your_go_to_items`
  (discover); `update_cart`, `get_cart`, `clear_cart` (cart); `checkout`
  (order); `get_orders`, `get_order_details`, `track_order` (track);
  `create_address`, `delete_address`, `get_addresses` (addresses);
  `report_error` (support).
- **GateWrite on checkout** — `checkout` is wrapped with `gateWrite`
  requiring Telegram approval.
- **Address switch pattern** — the agent follows the Instamart best practice:
  clear cart before switching delivery address, and warn the user.
- **Order memory** — after successful `checkout`, write a `memory_entries`
  row with `kind = "swiggy_order"` recording store, items summary,
  time-of-day, and day-of-week.

## Acceptance criteria

- [ ] User says "find milk" → agent returns products from `search_products`
- [ ] User says "show my go-to items" → agent returns frequently ordered
  products
- [ ] User says "add milk and eggs to cart" → agent updates cart and confirms
- [ ] User says "checkout" → agent sends Telegram approval prompt with cart
  summary
- [ ] User approves → `checkout` executes, order placed
- [ ] User says "track my grocery order" → agent returns delivery status
- [ ] User can view, add, and delete delivery addresses
- [ ] Switching delivery address mid-cart triggers a cart-clear warning
- [ ] Order memory entry is created after successful checkout
- [ ] All 13 Instamart tools are callable
- [ ] Tests: Instamart tool execution, gateWrite on checkout, address switch
  pattern, order memory

## Blocked by

- [#64](https://github.com/arka6fx/yomi/issues/64) — Swiggy auth + connector linking
