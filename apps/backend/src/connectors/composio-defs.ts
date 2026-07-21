import {
  makeComposioLinearDef, makeComposioGitHubDef, makeComposioSlackDef, makeComposioNotionDef,
  makeComposioGmailDef, makeComposioCalendarDef, makeComposioDriveDef, makeComposioClassroomDef,
  makeComposioTasksDef, makeComposioMeetDef, makeComposioDocsDef, makeComposioSheetsDef, makeComposioSlidesDef,
  makeComposioMapsDef,   makeComposioHubspotDef, makeComposioFirecrawlDef, makeComposioDiscordDef,
  makeComposioWhatsAppDef,
  makeComposioLinkedInDef,
  makeComposioOutlookDef,
  makeComposioDynamics365Def,
  makeComposioSerpapiDef,
  makeComposioNeonDef,
  makeComposioFirefliesDef,
  makeComposioGooglePhotosDef,
  makeComposioGoogleAdsDef,
  makeComposioGoogleAnalyticsDef,
  makeComposioGoogleSearchConsoleDef,
  makeComposioGoogleCloudVisionDef,
  makeComposioKaggleDef,
  type ConnectorDef, type ComposioExecutor,
} from "@yomi/agent-core"
import { createComposioRestExecutor } from "./composio-executor.js"

// Composio-backed defs the backend can serve, keyed by connector id, each wired
// with the real Composio executor. Passed to ConnectorRegistry, which uses a given
// entry ONLY when the connector is also flagged via COMPOSIO_CONNECTORS — so the
// native def stays in force until the flag flips.
//
// The executor is injectable so agent/run.ts can pass a per-turn counting executor
// for metering; defaults to a fresh REST executor otherwise.
export function buildComposioDefs(executor?: ComposioExecutor): Record<string, ConnectorDef> {
  const exec = executor ?? createComposioRestExecutor()
  return {
    linear: makeComposioLinearDef(exec),
    github: makeComposioGitHubDef(exec),
    slack: makeComposioSlackDef(exec),
    notion: makeComposioNotionDef(exec),
    google: makeComposioGmailDef(exec),
    "google-calendar": makeComposioCalendarDef(exec),
    "google-drive": makeComposioDriveDef(exec),
    "google-docs": makeComposioDocsDef(exec),
    "google-sheets": makeComposioSheetsDef(exec),
    "google-slides": makeComposioSlidesDef(exec),
    "google-classroom": makeComposioClassroomDef(exec),
    "google-tasks": makeComposioTasksDef(exec),
    "google-meet": makeComposioMeetDef(exec),
    "google-maps": makeComposioMapsDef(exec),
    hubspot: makeComposioHubspotDef(exec),
    firecrawl: makeComposioFirecrawlDef(exec),
    discord: makeComposioDiscordDef(exec),
    whatsapp: makeComposioWhatsAppDef(exec),
    linkedin: makeComposioLinkedInDef(exec),
    outlook: makeComposioOutlookDef(exec),
    "dynamics-365": makeComposioDynamics365Def(exec),
    serpapi: makeComposioSerpapiDef(exec),
    neon: makeComposioNeonDef(exec),
    fireflies: makeComposioFirefliesDef(exec),
    "google-photos": makeComposioGooglePhotosDef(exec),
    "google-ads": makeComposioGoogleAdsDef(exec),
    "google-analytics": makeComposioGoogleAnalyticsDef(exec),
    "google-search-console": makeComposioGoogleSearchConsoleDef(exec),
    "google-cloud-vision": makeComposioGoogleCloudVisionDef(exec),
    kaggle: makeComposioKaggleDef(exec),
  }
}
