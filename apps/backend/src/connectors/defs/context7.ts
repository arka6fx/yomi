import { context7Def } from "@yomi/agent-core"
import { registerConnectorDef } from "../registry.js"

// Native connector (not Composio-backed) — see context7-def.ts for why:
// Composio's "context7_mcp" toolkit isn't reachable through its REST tools/execute
// catalog, so this calls Context7's own public REST API directly.
registerConnectorDef(context7Def)
