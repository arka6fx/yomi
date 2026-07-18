## Parent

#62 — Swiggy MCP Connector

## What to build

Wire Swiggy's OAuth 2.1 + PKCE flow into Yomi and create the `swiggy-def.ts`
connector definition with auth config. The connector shows up in the dashboard
and users can link/unlink their Swiggy account.

Specifically:

- **`swiggy-def.ts`** in `packages/agent-core/src/connectors/` — the
  `ConnectorDef` for Swiggy with `isMCPBased: true`, `id: "swiggy"`, auth
  config matching Swiggy's OAuth 2.1 + PKCE flow. No tool factory yet.
- **`all-defs.ts`** — register `swiggyDef` in `ALL_CONNECTOR_DEFS`.
- **Backend Swiggy OAuth routes** — Swiggy-specific `buildAuthUrl` and
  `handleOAuth2Callback` that implement the PKCE flow (dynamic client
  registration at `POST /auth/register`, code challenge generation, phone+OTP
  flow). Integrate with Yomi's existing OAuth executor in
  `oauth2-executor.ts`.
- **MCP auth provider implementation** — `OAuthClientProvider` that reads
  encrypted tokens from `mcp_connections` for `provider = "swiggy"`. On 401,
  re-runs the PKCE authorization flow (no refresh tokens in Swiggy v1.0).
- **Dashboard** — the "Swiggy" connector card appears in the connectors list
  (data-driven from the def, no custom UI needed). User clicks "Connect",
  completes OAuth, sees status as connected.
- **Disconnect** — disconnect removes the encrypted tokens from
  `mcp_connections`.

## Acceptance criteria

- [ ] "Swiggy" appears in the dashboard connectors list
- [ ] User clicks "Connect" → redirected to Swiggy OAuth consent (phone + OTP)
- [ ] After successful OAuth, tokens are stored encrypted in `mcp_connections`
- [ ] Agent can retrieve the Swiggy access token via `getAccessToken("swiggy")`
- [ ] User clicks "Disconnect" → tokens removed, connector shows as disconnected
- [ ] 401 from Swiggy triggers re-auth (OAuthClientProvider handles this)
- [ ] `swiggyDef` is registered and visible in `ALL_CONNECTOR_DEFS`
- [ ] Tests: OAuth flow, token store/retrieve/re-auth

## Blocked by

- [#63](https://github.com/arka6fx/yomi/issues/63) — MCP connector infrastructure
