# MCP connector via AI SDK client

Status: accepted

## Context

Swiggy exposes its full API through MCP servers (streamable HTTP,
OAuth 2.1 + PKCE). Yomi's connector architecture uses native REST/GraphQL
`ToolFactory` functions or Composio executors — neither supports MCP. Enabling
Swiggy means introducing MCP client capability.

## Decision

Use the AI SDK's `MCPServerStreamableHttp` to connect to each Swiggy MCP
server. Build a new "MCP connector" variant in `ConnectorRegistry` that wraps
one or more `MCPServerStreamableHttp` instances and exposes their combined
tool sets as a standard AI SDK `ToolSet`. The OAuth lifecycle is handled by
Yomi's own `OAuthClientProvider` implementation, which reads encrypted tokens
from `mcp_connections` and runs PKCE against Swiggy's OAuth server.

Connection is lazy — servers connect on first tool call, not at session start.

## Considered options

- **Custom MCP client**: Build our own streamable HTTP client and JSON-RPC
  dispatcher. More control over reconnection and error handling, but
  duplicates the AI SDK's existing implementation. Rejected because the AI
  SDK already handles tool discovery, call dispatch, and auth provider
  integration.

- **Native REST connector**: Map tools to direct HTTP calls. Swiggy doesn't
  expose public REST APIs — only MCP. Not an option.

- **Composio executor**: Delegate to Composio if they add Swiggy support.
  Composio would manage the OAuth lifecycle and expose a flat REST API.
  Worth revisiting if Composio adds Swiggy, but today the direct MCP path
  is the only available integration and avoids an extra proxy hop.

## Consequences

- Tool definitions are discovered at runtime, not coded — no hardcoded Zod
  schemas per tool, but tool shapes are opaque until first connection.
- The `ConnectorRegistry` needs a new concept of "connected MCP servers"
  alongside the existing "connected provider with ToolFactory".
- MCP servers must pass through Yomi's usage metering layer — each tool call
  counts as a metered event.
- The 5-day access token (no refresh tokens in Swiggy v1.0) means Yomi must
  re-run the OAuth flow on 401. The `OAuthClientProvider` handles this.
