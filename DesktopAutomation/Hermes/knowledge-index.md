# Hermes — Knowledge Index

## Source Metadata
- **Source**: Yomi internal (Spec 19 — not yet implemented)
- **Type**: Architecture reference
- **Status**: Spec exists, implementation pending ("will provide later")
- **Last Updated**: 2026-06-12

## Hermes Messaging Gateway Architecture

### Concept
Hermes is Yomi's cloud messaging gateway — a unified interface for the AI agent to send and receive messages across platforms (WhatsApp, Telegram, Discord, Slack, etc.) through the Yomi backend, without the desktop needing to interact with each platform's UI directly.

### Architecture Pattern (from AGENTS.md)
```
Desktop Yomi → Sidecar → Backend (Hermes) → Platform APIs
                                          → WhatsApp Cloud API
                                          → Telegram Bot API
                                          → Discord Bot API
                                          → Slack Web API
```

### Key Design Decisions
- **Cloud-mediated**: Messages go through Yomi backend, not direct desktop↔platform
- **Authentication**: OAuth token per platform, stored encrypted in `mcp_connections` table
- **Session persistence**: Messages can be sent/received even when desktop is offline
- **Unified interface**: Same tool signature regardless of platform (`send_message`, `read_messages`)

### Agent Integration
- **send_message tool**: `{ platform, recipient, content }` → Hermes routes to platform
- **read_messages tool**: `{ platform, channel, limit }` → Hermes fetches recent messages
- **subscribe tool**: `{ platform, channel }` → Hermes pushes real-time updates via SSE

### Security
- OAuth tokens stored encrypted (`mcp_connections.oauth_tokens`)
- Messages never stored in cleartext logs
- PII redacted in `hook_logs`
- Per-user rate limiting per platform

### What Was Removed (2026-06)
- WhatsApp cloud adapter (762 lines: adapter, tests, webhooks, routes, types)
- Slack cloud adapter (189 lines: adapter, routes, types)
- `send_whatsapp_message` tool commented out

These were removed during cleanup but the architecture is still planned for future implementation.

### Yomi Implementation Opportunities
1. **Unified messaging abstraction**: Single `send_message` tool, platform routing internal
2. **Offline queue**: Queue messages when user is offline, deliver when desktop reconnects
3. **Message templates**: Pre-defined message formats for common agent responses
4. **Platform-aware formatting**: Auto-convert markdown to platform-specific formatting
5. **Read receipts**: Agent knows when its message was actually delivered/read
6. **Reconnection handling**: Transparent reconnect with message replay
