import type { ConnectorDef } from "./connector-def.js"
import { googleGmailDef } from "./google-gmail-def.js"
import { googleCalendarDef } from "./google-calendar-def.js"
import { googleDriveDef } from "./google-drive-def.js"
import { googleClassroomDef } from "./google-classroom-def.js"
import { githubDef } from "./github-def.js"
import { notionDef } from "./notion-def.js"
import { slackDef } from "./slack-def.js"
import { linearDef, linearApiKeyDef } from "./linear-def.js"

// All registered ConnectorDefs, in display order.
// Each def.id must match the provider key stored in mcp_connections.
// Adding a new connector = add a ConnectorDef here. No other code changes needed.
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  googleGmailDef,
  googleCalendarDef,
  googleDriveDef,
  googleClassroomDef,
  githubDef,
  notionDef,
  slackDef,
  linearDef,
  linearApiKeyDef,

]
