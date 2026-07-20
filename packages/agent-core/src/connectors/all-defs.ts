import type { ConnectorDef } from "./connector-def.js"
import { googleGmailDef } from "./google-gmail-def.js"
import { googleCalendarDef } from "./google-calendar-def.js"
import { googleDriveDef } from "./google-drive-def.js"
import { googleClassroomDef } from "./google-classroom-def.js"
import { googleTasksDef } from "./google-tasks-def.js"
import { googleMeetDef } from "./google-meet-def.js"
import { githubDef } from "./github-def.js"
import { notionDef } from "./notion-def.js"
import { slackDef } from "./slack-def.js"
import { linearDef } from "./linear-def.js"
import { swiggyDef } from "./swiggy-def.js"
import { makeComposioDocsDef } from "./composio/google-docs.js"
import { makeComposioSheetsDef } from "./composio/google-sheets.js"
import { makeComposioSlidesDef } from "./composio/google-slides.js"
import { makeComposioMapsDef } from "./composio/google-maps.js"
import { makeComposioHubspotDef } from "./composio/hubspot.js"
import { makeComposioFirecrawlDef } from "./composio/firecrawl.js"
import { makeComposioDiscordDef } from "./composio/discord.js"
import { makeComposioWhatsAppDef } from "./composio/whatsapp.js"
import { makeComposioLinkedInDef } from "./composio/linkedin.js"
import { makeComposioOutlookDef } from "./composio/outlook.js"
import { makeComposioFigmaDef } from "./composio/figma.js"
import { makeComposioTodoistDef } from "./composio/todoist.js"
import { makeComposioRedditDef } from "./composio/reddit.js"
import { makeComposioJiraDef } from "./composio/jira.js"
import { makeComposioAsanaDef } from "./composio/asana.js"
import { makeComposioYouTubeDef } from "./composio/youtube.js"
import { makeComposioZoomDef } from "./composio/zoom.js"
import type { ComposioExecutor } from "./composio/adapter.js"

// Docs/Sheets/Slides have no native (pre-Composio) implementation — unlike the
// other Google connectors, there's nothing to fall back to. ConnectorRegistry
// still needs a baseDef per id to iterate (see registry.ts), so these are built
// with a placeholder executor that only runs if the connector were ever
// connected while NOT listed in COMPOSIO_CONNECTORS — a misconfiguration, not a
// normal runtime path. The backend always injects a real executor via
// composio-defs.ts and takes over once the id is flagged.
const unconfiguredComposioExecutor: ComposioExecutor = {
  execute: async ({ slug }) => {
    throw new Error(
      `${slug} requires its connector id in COMPOSIO_CONNECTORS — the backend didn't inject a real Composio executor`,
    )
  },
}

// All registered ConnectorDefs, in display order.
// Each def.id must match the provider key stored in mcp_connections.
// Adding a new connector = add a ConnectorDef here. No other code changes needed.
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  googleGmailDef,
  googleCalendarDef,
  googleDriveDef,
  makeComposioDocsDef(unconfiguredComposioExecutor),
  makeComposioSheetsDef(unconfiguredComposioExecutor),
  makeComposioSlidesDef(unconfiguredComposioExecutor),
  googleClassroomDef,
  googleTasksDef,
  googleMeetDef,
  makeComposioMapsDef(unconfiguredComposioExecutor),
  githubDef,
  notionDef,
  slackDef,
  linearDef,
  makeComposioHubspotDef(unconfiguredComposioExecutor),
  makeComposioFirecrawlDef(unconfiguredComposioExecutor),
  makeComposioDiscordDef(unconfiguredComposioExecutor),
  makeComposioWhatsAppDef(unconfiguredComposioExecutor),
  makeComposioLinkedInDef(unconfiguredComposioExecutor),
  makeComposioOutlookDef(unconfiguredComposioExecutor),
  makeComposioFigmaDef(unconfiguredComposioExecutor),
  makeComposioTodoistDef(unconfiguredComposioExecutor),
  makeComposioRedditDef(unconfiguredComposioExecutor),
  makeComposioJiraDef(unconfiguredComposioExecutor),
  makeComposioAsanaDef(unconfiguredComposioExecutor),
  makeComposioYouTubeDef(unconfiguredComposioExecutor),
  makeComposioZoomDef(unconfiguredComposioExecutor),
  swiggyDef,
]
