# Custom MCP Servers — Design

Date: 2026-07-21
Status: Approved (design); pending implementation plan

## Summary

Let a user add their own MCP (Model Context Protocol) servers — name, URL,
optional API key — and have their tools available to the Telegram agent,
alongside Yomi's built-in connectors. Reuses
`packages/agent-core/src/connectors/mcp-connector.ts`, a fully generic MCP
client already built for (and currently only used by) the Swiggy
connector — this feature is new schema, new routes, and new registry
wiring around that existing engine, not a new MCP client implementation.

This is the larger of two sub-projects bundled together in this planning
cycle (the other, the post-signup screen, has its own spec:
`docs/superpowers/specs/2026-07-21-post-signup-telegram-screen-design.md`
— the two are otherwise unrelated and can ship independently).

## Scope (v1)

- **In scope:** a `custom_mcp_servers` table, CRUD API routes, wiring
  custom servers into `ConnectorRegistry`'s tool loading, a UI section for
  adding/listing/removing custom servers, API-key-header auth only.
- **In scope, but a pre-existing gap this feature must also fix:**
  `ConnectorRegistry.loadMCPTools()` — the method that actually connects
  to MCP servers — is defined but never called anywhere in
  `apps/backend`. This means MCP-based connectors (currently only Swiggy,
  via `isMCPBased`/`connectMCP`) don't actually load their tools in
  production today. This feature's custom-server loading depends on that
  same call path actually running, so wiring it into `run.ts` is required
  regardless — and fixes Swiggy's dormant path as a side effect (Swiggy
  itself is still blocked on their OAuth allowlist per
  `project_swiggy_connector_whitelist` — this only fixes the *loading*
  mechanism, not that separate, unrelated blocker).
- **Out of scope:** the "auto-detect oauth" behavior implied by the
  reference screenshot's helper text — dynamic MCP OAuth discovery and
  per-server client registration is a substantially larger feature
  (RFC 8414/9728-style discovery, dynamic client registration, token
  storage per arbitrary server) than a static API-key header. v1 supports
  exactly two auth modes: `Authorization: Bearer <key>` when a key is
  provided, or no auth header when the field is left empty (for servers
  that don't require auth). Explicitly not "leave empty to auto-detect" —
  the UI copy must not imply auto-detection isn't built yet.
- **Out of scope:** editing an existing custom server (add/delete only —
  editing means delete-and-re-add for v1), rate-limiting how many custom
  servers a user can add (no abuse pattern to defend against yet; revisit
  if it becomes one), streaming/stdio MCP transports (only `sse`, matching
  what `mcp-connector.ts` already supports).

## Design

### 1. Schema (`packages/db/src/schema.ts`)

```ts
export const customMcpServers = pgTable(
  "custom_mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    // AES-256-GCM encrypted via encryptString/decryptString
    // (token-encryption.ts) — same scheme already used for OAuth tokens.
    // Null when the server doesn't require auth.
    apiKeyEncrypted: text("api_key_encrypted"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUrlUnique: unique("custom_mcp_servers_user_url_unique").on(t.userId, t.url),
  }),
)
```

Placed near `mcpConnections` in the same file, following its exact column
and constraint conventions. No new imports needed — `pgTable`, `uuid`,
`text`, `timestamp`, `unique` are already imported at the top of
`schema.ts`.

After adding this, run `bun run db:generate` (from `packages/db`) to
produce the migration SQL (next file: `0032_<name>.sql`, following the
existing sequence through `0031_session_recall.sql`). Per this project's
own convention, deploying the code does **not** run the migration —
`bun run db:migrate` must be run against the live DB separately after
merge.

### 2. Backend routes (`apps/backend/src/routes/custom-mcp.ts`, new file)

Follows `integrations.ts`'s patterns (`authenticate` middleware, `db` from
`@yomi/db`, `encryptString`/`decryptString` from `token-encryption.ts`):

```ts
import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, customMcpServers } from "@yomi/db"
import { authenticate } from "../auth.js"
import { encryptString } from "../services/token-encryption.js"

export const customMcpRouter = new Hono()

customMcpRouter.get("/", authenticate, async (c) => {
  const userId = c.get("user").id
  const rows = await db
    .select({ id: customMcpServers.id, name: customMcpServers.name, url: customMcpServers.url })
    .from(customMcpServers)
    .where(eq(customMcpServers.userId, userId))
  return c.json({ servers: rows })
})

customMcpRouter.post("/", authenticate, async (c) => {
  const userId = c.get("user").id
  const body = (await c.req.json()) as { name?: string; url?: string; apiKey?: string }
  if (!body.name?.trim() || !body.url?.trim()) {
    return c.json({ error: "name and url are required" }, 400)
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(body.url)
  } catch {
    return c.json({ error: "url must be a valid URL" }, 400)
  }
  if (parsedUrl.protocol !== "https:") {
    return c.json({ error: "url must use https" }, 400)
  }

  const [row] = await db
    .insert(customMcpServers)
    .values({
      userId,
      name: body.name.trim(),
      url: body.url.trim(),
      apiKeyEncrypted: body.apiKey?.trim() ? encryptString(body.apiKey.trim()) : null,
    })
    .returning({ id: customMcpServers.id, name: customMcpServers.name, url: customMcpServers.url })
    .catch((err) => {
      // unique constraint on (userId, url)
      if (String(err).includes("custom_mcp_servers_user_url_unique")) {
        throw new Error("You've already added a server with this URL")
      }
      throw err
    })
  return c.json({ server: row }, 201)
})

customMcpRouter.delete("/:id", authenticate, async (c) => {
  const userId = c.get("user").id
  const id = c.req.param("id")
  await db
    .delete(customMcpServers)
    .where(and(eq(customMcpServers.id, id), eq(customMcpServers.userId, userId)))
  return c.json({ ok: true })
})
```

(HTTPS-only is a deliberate v1 constraint — an MCP server URL carries the
user's API key in every request header; plaintext `http://` would leak it
on the wire.)

Registered in `apps/backend/src/index.ts` alongside every other router:

```ts
import { customMcpRouter } from "./routes/custom-mcp.js"
// ...
app.route("/api/custom-mcp", customMcpRouter)
```

### 3. Registry wiring (`packages/agent-core/src/connectors/registry.ts`)

`ConnectorRegistryDeps` gains one new optional dependency:

```ts
listCustomMcpServers?: (userId: string) => Promise<
  { id: string; name: string; url: string; apiKey: string | null }[]
>
```

(Decryption happens in the backend's implementation of this function —
same layering as `getAccessToken`, which already returns decrypted
tokens; `agent-core` never touches the encryption key directly.)

`loadMCPTools()` — currently:

```ts
async loadMCPTools(): Promise<void> {
  if (!this.userId || this.mcpConnectedIds.length === 0) return
  if (Object.keys(this.mcpTools).length > 0) return

  for (const baseDef of ALL_CONNECTOR_DEFS) {
    if (!this.mcpConnectedIds.includes(baseDef.id)) continue
    // ...existing connectMCP loop...
  }
}
```

— gains a second, independent block after the existing loop, guarded by
its own already-loaded check so re-calling `loadMCPTools()` doesn't
reconnect on every turn:

```ts
  if (this.deps.listCustomMcpServers && Object.keys(this.customMcpTools).length === 0) {
    try {
      const servers = await this.deps.listCustomMcpServers(this.userId)
      if (servers.length > 0) {
        const { createMCPToolProvider } = await import("./mcp-connector.js")
        const provider = createMCPToolProvider()
        const tools = await provider.loadTools({
          userId: this.userId,
          servers: servers.map((s) => ({ id: s.id, url: s.url })),
          authProvider: {
            async getHeaders() {
              return {}
            },
          },
        })
        this.customMcpTools = tools
      }
    } catch (err) {
      console.error(`[registry] custom MCP server load failed:`, err)
    }
  }
```

This is a **separate `loadTools()` call** from the built-in-connector
loop above it — a broken custom server URL can only fail this block (all
caught, logged, never thrown further), never the Swiggy/built-in path,
and vice versa.

The per-server `authProvider.getHeaders()` above is a placeholder in this
sketch — it needs to return `{ Authorization: `Bearer ${apiKey}` }` when
that specific server has a key, `{}` otherwise. Since `MCPServerConfig` in
`mcp-connector.ts` only carries `{ id, url }` (no per-server auth data)
and `MCPAuthProvider.getHeaders` doesn't receive the server as an
argument, either (a) close over a `Map<id, apiKey>` built from `servers`
before constructing `authProvider`, or (b) call `loadTools()` once per
server instead of once for all of them (simpler, still fine — a handful
of custom servers per user, not hundreds). **Decide which at
implementation time**; both are small, and this doesn't change the
public shape of anything outside this one method.

New field: `private customMcpTools: ToolSet = {}`, reset in
`buildConnectors()`'s existing clear-block alongside `this.mcpTools = {}`.
`getAllDefTools()` changes from `{ ...this.defTools, ...this.mcpTools }`
to `{ ...this.defTools, ...this.mcpTools, ...this.customMcpTools }`.

### 4. Wiring the dormant call site (`apps/backend/src/agent/run.ts`)

Right after `await registry.init(opts.userId)`:

```ts
await registry.loadMCPTools()
```

And the backend's `ConnectorRegistry` construction (wherever
`buildComposioDefs`/`getAccessToken`/`listConnectedProviders` are
currently passed in) gains:

```ts
listCustomMcpServers: async (userId: string) => {
  const rows = await db
    .select()
    .from(customMcpServers)
    .where(eq(customMcpServers.userId, userId))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    apiKey: r.apiKeyEncrypted ? decryptString(r.apiKeyEncrypted) : null,
  }))
},
```

### 5. UI (`packages/ui-connectors/src/components/CustomMcpServers.tsx`, new)

A separate section rendered below `ConnectorMarketplace` on the
connections tab (per the earlier UI-placement decision) — not a
`ConnectorTile`, since a custom server has no catalog entry (no fixed
icon, arbitrary user-chosen name):

```tsx
export interface CustomMcpServerInfo {
  id: string
  name: string
  url: string
}

export function CustomMcpServers({
  servers,
  theme: t,
  onAdd,
  onDelete,
}: {
  servers: CustomMcpServerInfo[]
  theme: ConnectorTheme
  onAdd: (input: { name: string; url: string; apiKey: string }) => Promise<void>
  onDelete: (id: string) => void
}) {
  // list of `servers` as simple rows (name, url, delete button) reusing
  // the same row visual language as the redesigned ConnectorMarketplace —
  // plus an inline "Add custom server" form: name / url / optional api key
  // fields, matching the reference's field set and helper text, EXCEPT the
  // helper text must say "leave empty if the server doesn't require auth"
  // — not "auto-detect oauth", since that's explicitly not built (see
  // Scope).
}
```

Full JSX and form-state handling (loading/error states on add, confirm-
before-delete) is an implementation-time detail, not a design decision —
follows the same patterns already established in `ConnectorMarketplace.tsx`
(inline styles against `ConnectorTheme`, no new styling system).

Wired into `apps/landing/src/app/dashboard/page.tsx`: new state
(`customServers`, fetched from `GET /api/custom-mcp` alongside the
existing `connectedProviders`/`integrationHealth` fetch), handlers that
call the new routes and refetch, rendered below `<ConnectorMarketplace>`.

## Testing

- **Backend routes** (`custom-mcp.test.ts`): create/list/delete happy
  paths, ownership scoping (one user can't delete another's row — insert
  as user A, attempt delete as user B, assert it's still there), HTTPS-
  only validation, duplicate-URL rejection, API key never appears in the
  list response.
- **Registry** (`registry.test.ts` or a new focused file): `loadMCPTools()`
  merges custom-server tools into `getAllDefTools()` when
  `listCustomMcpServers` is provided and returns servers; a custom-server
  connection failure doesn't prevent built-in MCP-def tools from loading
  (and vice versa) — mock `./mcp-connector.js`'s `createMCPToolProvider`
  the same way `run.test.ts` already mocks `@yomi/agent-core` exports via
  `mock.module`.
- **UI**: no automated test, consistent with the rest of `ui-connectors`
  — verify with typecheck + lint, manual check needs a real signed-in
  session (same sandbox limitation noted in every UI spec this session).

## Migration reminder

This feature adds a schema change. After the implementation plan's tasks
land and merge, `bun run db:migrate` (from `packages/db`) must be run
against the live database — deploying the code does not run it
automatically, per this project's established convention.
