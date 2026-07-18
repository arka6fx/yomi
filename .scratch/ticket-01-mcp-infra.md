## Parent

#62 — Swiggy MCP Connector

## What to build

Build the shared MCP connector infrastructure that Swiggy and future MCP-based
connectors depend on. Specifically:

- **`mcp-connector.ts`** in `packages/agent-core/src/connectors/` — shared
  utilities: lazy connection manager, tool discovery cache, MCP server lifecycle
  (connect, disconnect, reconnect on 401).
- **`ConnectorDef` extension** — add a `isMCPBased: true` flag so the registry
  can distinguish MCP connectors from native `ToolFactory` connectors. MCP
  connectors don't call `def.tools(ctx)` eagerly; instead they register a lazy
  tool loader.
- **`ConnectorRegistry.buildConnectors()`** — when it encounters an
  `isMCPBased` def whose provider is connected, skip the eager `def.tools()`
  call and instead register a lazy loader that connects to the MCP server(s)
  on first tool use.
- **MCP auth provider interface** — the shape of Yomi's
  `OAuthClientProvider` implementation (the actual implementation for Swiggy
  comes in ticket #2). Define the interface in `mcp-connector.ts` so all MCP
  connectors share the same auth contract.

No user-facing behavior yet — this is the prefactor that makes the subsequent
tickets possible.

## Acceptance criteria

- [ ] `ConnectorDef` has an `isMCPBased` flag (defaulting to `false`)
- [ ] `ConnectorRegistry` skips eager tool loading for `isMCPBased` defs
- [ ] `ConnectorRegistry` provides a lazy tool loading mechanism for MCP defs
- [ ] `mcp-connector.ts` exports a lazy connection manager and MCP auth provider interface
- [ ] Existing native connectors are unaffected (default `isMCPBased: false`)
- [ ] Tests pass: registry handles MCP defs alongside native defs

## Blocked by

None — can start immediately.
