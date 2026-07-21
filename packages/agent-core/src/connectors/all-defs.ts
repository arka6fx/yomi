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
import { makeComposioSalesforceDef } from "./composio/salesforce.js"
import { makeComposioInstagramDef } from "./composio/instagram.js"
import { makeComposioFacebookDef } from "./composio/facebook.js"
import { makeComposioCalendlyDef } from "./composio/calendly.js"
import { makeComposioTrelloDef } from "./composio/trello.js"
import { makeComposioOneDriveDef } from "./composio/one-drive.js"
import { makeComposioPostHogDef } from "./composio/posthog.js"
import { makeComposioAttioDef } from "./composio/attio.js"
import { makeComposioZohoDef } from "./composio/zoho.js"
import { makeComposioDropboxDef } from "./composio/dropbox.js"
import { makeComposioMicrosoftTeamsDef } from "./composio/microsoft-teams.js"
import { makeComposioGumroadDef } from "./composio/gumroad.js"
import { makeComposioMiroDef } from "./composio/miro.js"
import { makeComposioDynamics365Def } from "./composio/dynamics-365.js"
import { makeComposioSerpapiDef } from "./composio/serpapi.js"
import { makeComposioExaDef } from "./composio/exa.js"
import { makeComposioMem0Def } from "./composio/mem0.js"
import { makeComposioCloudflareDef } from "./composio/cloudflare.js"
import { makeComposioVercelDef } from "./composio/vercel.js"
import { makeComposioSupabaseDef } from "./composio/supabase.js"
import { makeComposioStripeDef } from "./composio/stripe.js"
import { makeComposioZohoInvoiceDef } from "./composio/zoho-invoice.js"
import { makeComposioNeonDef } from "./composio/neon.js"
import { makeComposioFirefliesDef } from "./composio/fireflies.js"
import { makeComposioGooglePhotosDef } from "./composio/google-photos.js"
import { makeComposioGoogleAdsDef } from "./composio/google-ads.js"
import { makeComposioGoogleAnalyticsDef } from "./composio/google-analytics.js"
import { makeComposioGoogleSearchConsoleDef } from "./composio/google-search-console.js"
import { makeComposioGoogleCloudVisionDef } from "./composio/google-cloud-vision.js"
import { makeComposioKaggleDef } from "./composio/kaggle.js"
import { context7Def } from "./context7-def.js"
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
  makeComposioSalesforceDef(unconfiguredComposioExecutor),
  makeComposioFacebookDef(unconfiguredComposioExecutor),
  makeComposioInstagramDef(unconfiguredComposioExecutor),
  makeComposioCalendlyDef(unconfiguredComposioExecutor),
  makeComposioTrelloDef(unconfiguredComposioExecutor),
  makeComposioOneDriveDef(unconfiguredComposioExecutor),
  makeComposioPostHogDef(unconfiguredComposioExecutor),
  makeComposioAttioDef(unconfiguredComposioExecutor),
  makeComposioZohoDef(unconfiguredComposioExecutor),
  makeComposioDropboxDef(unconfiguredComposioExecutor),
  makeComposioMicrosoftTeamsDef(unconfiguredComposioExecutor),
  makeComposioGumroadDef(unconfiguredComposioExecutor),
  makeComposioMiroDef(unconfiguredComposioExecutor),
  makeComposioDynamics365Def(unconfiguredComposioExecutor),
  makeComposioSerpapiDef(unconfiguredComposioExecutor),
  makeComposioExaDef(unconfiguredComposioExecutor),
  makeComposioMem0Def(unconfiguredComposioExecutor),
  makeComposioCloudflareDef(unconfiguredComposioExecutor),
  makeComposioVercelDef(unconfiguredComposioExecutor),
  makeComposioSupabaseDef(unconfiguredComposioExecutor),
  makeComposioStripeDef(unconfiguredComposioExecutor),
  makeComposioZohoInvoiceDef(unconfiguredComposioExecutor),
  makeComposioNeonDef(unconfiguredComposioExecutor),
  makeComposioFirefliesDef(unconfiguredComposioExecutor),
  makeComposioGooglePhotosDef(unconfiguredComposioExecutor),
  makeComposioGoogleAdsDef(unconfiguredComposioExecutor),
  makeComposioGoogleAnalyticsDef(unconfiguredComposioExecutor),
  makeComposioGoogleSearchConsoleDef(unconfiguredComposioExecutor),
  makeComposioGoogleCloudVisionDef(unconfiguredComposioExecutor),
  makeComposioKaggleDef(unconfiguredComposioExecutor),
  context7Def,
  swiggyDef,
]
