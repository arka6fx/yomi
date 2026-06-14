import type { ConnectorDef } from "./connector-def.js"
import { googleGmailDef } from "./google-gmail-def.js"
import { googleCalendarDef } from "./google-calendar-def.js"
import { googleDriveDef } from "./google-drive-def.js"
import { githubDef } from "./github-def.js"

// All registered ConnectorDefs, in display order.
// Each def.id must match the provider key stored in mcp_connections.
// Adding a new connector = add a ConnectorDef here. No other code changes needed.
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  googleGmailDef,
  googleCalendarDef,
  googleDriveDef,
  githubDef,
  // Checkpoint 3: notion, slack, linear, linearApiKey, postgres, mysql
]
