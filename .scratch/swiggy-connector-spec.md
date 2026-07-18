# Swiggy MCP Connector

## Problem Statement

Yomi users interact with the app primarily through Telegram — they ask for
information, set reminders, and manage tasks. But food delivery, grocery
shopping, and restaurant reservations are daily activities that happen outside
Yomi. Users must switch to the Swiggy app to order food, check delivery status,
or book a table. There's no way to say "order biryani to my home address" or
"find me a table for dinner tonight" inside Yomi and have it done.

## Solution

Wire Swiggy's three MCP servers (Food, Instamart, Dineout) into Yomi's agent
loop as a single "Swiggy" connector. Users link their Swiggy account once via
OAuth 2.1 + PKCE, then interact with all 35 Swiggy tools through Yomi's
existing Telegram chat surface. The connector uses the AI SDK's built-in
`MCPServerStreamableHttp` for MCP transport, with Yomi's own
`OAuthClientProvider` handling the PKCE flow against Swiggy's OAuth server.

Order-placing tools (`place_food_order`, `checkout`, `book_table`) go through
Yomi's `gateWrite` approval — the user confirms in Telegram before any
financial action executes. Successful orders are recorded as Order memory in
`memory_entries` so the Evidence gate can detect recurring behavior and earn
proactive suggestions.

## User Stories

1. As a Yomi user, I want to link my Swiggy account to Yomi from the dashboard,
   so that I can order food and groceries without leaving the chat.
2. As a Yomi user, I want to place a food delivery order by typing "order
   biryani to my home" in Telegram, so that the agent discovers restaurants,
   builds a cart, and places the order on my behalf.
3. As a Yomi user, I want to confirm or cancel each order in Telegram before it
   goes through, so that I have control over financial transactions.
4. As a Yomi user, I want to search restaurants by cuisine or dish, so that I
   can discover what's available near me.
5. As a Yomi user, I want to browse a restaurant's full menu with prices, so
   that I can decide what to order.
6. As a Yomi user, I want to add, remove, or change quantities of items in my
   cart, so that I can customize my order before placing it.
7. As a Yomi user, I want to apply available coupons to my food order, so that
   I save money.
8. As a Yomi user, I want to track my active food delivery in real-time, so
   that I know when to expect my order.
9. As a Yomi user, I want to check my recent and active food orders, so that I
   can see order history and status.
10. As a Yomi user, I want to order groceries via Instamart by typing "get me
    milk and eggs" in Telegram, so that the agent searches products, builds a
    cart, and checks out.
11. As a Yomi user, I want to browse Instamart products by category or search
    term, so that I can find what I need.
12. As a Yomi user, I want to manage my delivery addresses (view, add, delete)
    through Yomi, so that I can send orders to the right place.
13. As a Yomi user, I want to see my frequently ordered Instamart items, so
    that I can re-order my go-to items quickly.
14. As a Yomi user, I want to book a restaurant table via Dineout by typing
    "book a table for 2 at 8pm" in Telegram, so that the agent checks
    availability and makes the reservation.
15. As a Yomi user, I want to search Dineout restaurants by location or
    cuisine, so that I can find where to eat out.
16. As a Yomi user, I want to check available time slots at a restaurant before
    booking, so that I can pick a convenient time.
17. As a Yomi user, I want to check my Dineout booking status, so that I can
    confirm or modify my plans.
18. As a Yomi user, I want the agent to connect to Swiggy only when I ask
    about food, so that resources aren't wasted if I never use the feature.
19. As a Yomi user, I want the Swiggy connector to appear in the dashboard
    alongside my other connectors, so that I can manage linking and
    unlinking from one place.
20. As a Yomi user, I want to disconnect my Swiggy account from Yomi at any
    time, so that I control which services have access.
21. As a Yomi user supported by the agent, I want the agent to remember my past
    orders (restaurant, time of day, day of week) when I've consented to
    memory, so that it can proactively suggest re-ordering my usual.
22. As a Yomi user, I want the agent to handle cart state correctly across
    multiple turns, so that adding items, changing quantities, and placing the
    order works without losing my selections.
23. As a Yomi operator, I want Swiggy tool calls metered against the user's
    credit balance, so that Yomi is compensated for the compute cost.
24. As a Yomi operator, I want the MCP auth provider to handle 401 responses
    gracefully by re-running the OAuth flow, so that 5-day token expiry
    doesn't break the user experience.

## Implementation Decisions

### Architecture

**MCP connector pattern**: A new "MCP connector" variant alongside the existing
native `ToolFactory` and Composio executor patterns. The `ConnectorRegistry`
gains a new concept of "connected MCP servers" — Swiggy is the pilot for this
pattern. Each MCP server is an `MCPServerStreamableHttp` instance from the AI
SDK, configured with a URL (`mcp.swiggy.com/food`, `/im`, `/dineout`) and a
shared `OAuthClientProvider`.

**Single connector, three servers**: The connector appears as one provider
(`swiggy`) in the dashboard and `mcp_connections`. During initialization, one
OAuth token is obtained (shared across all three servers). Connection to each
MCP server is lazy — the server is connected on the first tool call directed at
it, not at session start.

**Lazy connection**: On registry init, no MCP server connection is made. The
first tool call targeting a Swiggy server triggers an on-demand
`server.connect()`. If the connection fails (network, auth expired), the error
propagates to the agent which can explain to the user.

### Auth

**MCP auth provider**: Yomi implements the MCP SDK's `OAuthClientProvider`
interface. The provider reads the encrypted access token from `mcp_connections`
for `swiggy`. If no token exists, it initiates the PKCE authorization flow
against `mcp.swiggy.com/auth/authorize` (phone + OTP in browser). On 401,
re-runs the authorization flow. The 5-day access token is treated as the full
session — no refresh token support in Swiggy v1.0.

**Dashboard OAuth flow**: The Swiggy connector uses Yomi's existing
`buildAuthUrl` → `handleOAuth2Callback` pattern from `oauth2-executor.ts`. The
difference is that instead of exchanging code for tokens directly, Yomi
completes the flow and stores the resulting access token encrypted in
`mcp_connections.oauthTokens` under the `swiggy` provider id.

### Tool lifecycle

**Tool discovery**: Unlike native connectors where tools are coded as Zod
schemas + execute functions, MCP tools are discovered at runtime via
`tools/list` after connection. The AI SDK's MCP client handles this and
converts them to AI SDK `tool()` objects automatically. The `ConnectorRegistry`
collects these from all connected MCP servers and merges them into
`getAllDefTools()`.

**GateWrite guarding**: Order-placing tools (`place_food_order`, `checkout`,
`book_table`) are intercepted by Yomi's `gateWrite` approval layer. When the
agent calls one of these tools, the call is queued as a pending action and the
user must confirm in Telegram. On confirmation, the tool executes against the
real MCP server. On rejection, the cart is flushed.

**Multi-turn cart handling**: The agent follows the "refresh at turn boundary"
pattern — `get_food_cart` or `get_cart` is called at the start of every turn
that might involve cart state. Cart state is server-side and never cached in
agent memory. Restaurant switch (Food) auto-flushes the cart; the agent warns
the user before switching.

### Order memory

After a successful `place_food_order`, `checkout`, or `book_table`, the agent
writes a `memory_entries` row with `kind = "swiggy_order"`. The record contains:
connector (`swiggy`), sub-service (`food` | `im` | `dineout`), restaurant/store
name, items summary (truncated, content-free), time-of-day bucket, and
day-of-week. This feeds the existing Evidence gate which can earn a proactive
suggestion for recurring ordering behavior.

### Metering

Each Swiggy MCP tool call counts as a metered usage event via
`chargeUsage()`, following the same pattern as other connector tool calls. The
credit cost is defined in `credit-pricing.ts` — Swiggy calls are metered as
standard tool executions (not premium).

### Schema

The existing `mcp_connections` table is used with `provider = "swiggy"`. The
`oauthTokens` column stores the encrypted Swiggy access token (and future
refresh token when Swiggy v1.1 ships). No schema changes are needed for v1.

### Modules

**New files in `packages/agent-core/src/connectors/`**:
- `swiggy-def.ts` — The `ConnectorDef` for Swiggy, including a new tool factory
  that creates `MCPServerStreamableHttp` instances and returns a merged
  `ToolSet`. Tracks which MCP servers are connected.
- `mcp-connector.ts` — Shared utilities for MCP connectors: lazy connection
  manager, tool discovery cache, OAuth provider factory.

**Modified files in `packages/agent-core/src/connectors/`**:
- `all-defs.ts` — Add `swiggyDef` to `ALL_CONNECTOR_DEFS`.
- `connector-def.ts` — Maybe: new `MCPConnectorDef` variant or a flag
  `isMCPBased: true` on `ConnectorDef`.
- `registry.ts` — Handle `def.isMCPBased` in `buildConnectors()`: instead of
  calling `def.tools(ctx)` eagerly, register a lazy tool loader that connects
  on first use.

**New files in `apps/backend/src/`**:
- `connectors/mcp-auth-provider.ts` — The `OAuthClientProvider` implementation
  that reads from `mcp_connections` and runs PKCE against Swiggy's OAuth server.
- `connectors/oauth/swiggy.ts` — Swiggy-specific OAuth routes: `buildAuthUrl`,
  `handleOAuth2Callback` (wrapping the PKCE + dynamic client registration flow).

**Modified files in `apps/backend/src/`**:
- `connectors/defs/index.ts` — Register the Swiggy backend def.
- `services/integration-tokens.ts` — Add Swiggy to the 401 detection for
  re-auth (map `provider === "swiggy"` → special re-auth path since Swiggy uses
  MCP OAuth, not standard OAuth2 token refresh).
- `services/metering.ts` — Swiggy tool calls are metered like any other tool
  call (no special pricing).

## Testing Decisions

### What makes a good test

Tests should verify external behavior, not implementation details. A good test
for the Swiggy connector checks that:
- When Swiggy is connected, tools appear in the registry's `getAllDefTools()`
- Tools are discoverable at runtime after MCP server connection
- Order-placing tools trigger `gateWrite` approval
- Order memory is written only after a successful order placement
- 401 errors cause re-auth rather than silent failure
- Lazy connection works — no MCP server connection is attempted at registry init

### Seams

1. **ConnectorRegistry** (`packages/agent-core/src/connectors/registry.test.ts`)
   — Test that the registry handles MCP-based defs alongside native defs. Mock
   `listConnectedProviders` to return `["swiggy"]` and `getAccessToken` to
   return a fake Swiggy token. Verify that `getAllDefTools()` returns Swiggy
   tools after the lazy connection trigger.
   - Prior art: `packages/agent-core/src/connectors/registry.test.ts`

2. **Swiggy connector tool execution** (`packages/agent-core/src/connectors/`)
   — Test the tool discovery + execution flow by mocking the MCP transport layer
   (fake `MCPServerStreamableHttp` or mock the fetch calls it makes). Test the
   search → cart → place order flow including `gateWrite` interception.
   - Prior art: `packages/agent-core/src/connectors/github-def.test.ts`

3. **MCP auth provider** (`apps/backend/src/connectors/`) — Test the
   `OAuthClientProvider` with mocked Swiggy OAuth responses. Test that a stored
   token is used when valid, that PKCE flow is initiated when no token exists,
   and that 401 triggers re-auth.
   - Prior art: `apps/backend/src/connectors/composio-executor.test.ts`

## Out of Scope

- **Swiggy voice ordering** — Voice-based ordering through Yomi's existing
  STT/TTS pipeline is not part of this spec. Voice agents have different
  response contracts (see Swiggy's "Voice vs chat" pattern). Will be addressed
  separately.
- **Widget rendering** — Swiggy MCP-UI widgets (restaurant cards, menu items,
  cart previews) are not rendered in Telegram's UI. The agent returns text
  descriptions only.
- **Multiple Swiggy accounts** — One Swiggy account per Yomi user. Support for
  multiple accounts (personal + family) is future work.
- **Swiggy payment handling** — The user pays Swiggy directly (COD, wallet,
  card). Yomi does not handle payment.
- **Offline menus** — No caching of restaurant menus for offline use.
- **Refresh tokens** — Swiggy v1.0 doesn't issue refresh tokens. The 5-day
  access token is the full session. Rolling refresh is on the Swiggy roadmap
  (v1.1) and will be adopted when available.
- **Proactive meal suggestions** — The Order memory infrastructure is built
  here, but the proactive suggestion generator that consumes it is separate
  work.

## Further Notes

- **Swiggy access levels**: Swiggy Builders Club has an access-gated production
  tier. Development works on `localhost` without special access. When ready for
  production, a video demo is required for credentials. This spec covers the
  development path end-to-end.
- **MCP as a pattern**: Swiggy is Yomi's pilot for MCP-based connectors. If
  successful, the `mcp-connector.ts` utilities can be reused for future MCP
  service integrations. The architecture treats MCP as one connector transport
  alongside native REST and Composio — not a replacement for either.
- **Cart identity**: Swiggy carts are per-server (Food cart ≠ Instamart cart).
  The agent handles each independently. A combined "plan my evening" flow (Food
  + Dineout) is a higher-level agent orchestration concern, not a connector
  issue.
