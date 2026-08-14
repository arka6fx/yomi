import {
  makeComposioLinearDef,
  makeComposioGitHubDef,
  makeComposioSlackDef,
  makeComposioNotionDef,
  makeComposioGmailDef,
  makeComposioCalendarDef,
  makeComposioDriveDef,
  makeComposioClassroomDef,
  makeComposioTasksDef,
  makeComposioMeetDef,
  makeComposioDocsDef,
  makeComposioSheetsDef,
  makeComposioSlidesDef,
  makeComposioMapsDef,
  makeComposioHubspotDef,
  makeComposioFirecrawlDef,
  makeComposioDiscordDef,
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
  makeComposioFigmaDef,
  makeComposioTodoistDef,
  makeComposioRedditDef,
  makeComposioJiraDef,
  makeComposioAsanaDef,
  makeComposioYouTubeDef,
  makeComposioZoomDef,
  makeComposioSalesforceDef,
  makeComposioFacebookDef,
  makeComposioInstagramDef,
  makeComposioCalendlyDef,
  makeComposioTrelloDef,
  makeComposioOneDriveDef,
  makeComposioPostHogDef,
  makeComposioAttioDef,
  makeComposioZohoDef,
  makeComposioDropboxDef,
  makeComposioMicrosoftTeamsDef,
  makeComposioGumroadDef,
  makeComposioMiroDef,
  makeComposioExaDef,
  makeComposioMem0Def,
  makeComposioCloudflareDef,
  makeComposioVercelDef,
  makeComposioSupabaseDef,
  makeComposioStripeDef,
  makeComposioZohoInvoiceDef,
  type ConnectorDef,
  type ComposioExecutor,
  createComposioTools,
  type ComposioToolSpec,
} from "@yomi/agent-core"
import { createComposioRestExecutor } from "./composio-executor.js"

// Composio-backed defs the backend can serve, keyed by connector id, each wired
// with the real Composio executor. Passed to ConnectorRegistry, which uses a given
// entry ONLY when the connector is also flagged via COMPOSIO_CONNECTORS — so the
// native def stays in force until the flag flips.
//
// The executor is injectable so agent/run.ts can pass a per-turn counting executor
// for metering; defaults to a fresh REST executor otherwise.
export function buildComposioDefs(
  executor?: ComposioExecutor,
  catalogSpecs: ComposioToolSpec[] = [],
): Record<string, ConnectorDef> {
  const exec = executor ?? createComposioRestExecutor()
  const defs: Record<string, ConnectorDef> = {
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
    figma: makeComposioFigmaDef(exec),
    todoist: makeComposioTodoistDef(exec),
    reddit: makeComposioRedditDef(exec),
    jira: makeComposioJiraDef(exec),
    asana: makeComposioAsanaDef(exec),
    youtube: makeComposioYouTubeDef(exec),
    zoom: makeComposioZoomDef(exec),
    salesforce: makeComposioSalesforceDef(exec),
    facebook: makeComposioFacebookDef(exec),
    instagram: makeComposioInstagramDef(exec),
    calendly: makeComposioCalendlyDef(exec),
    trello: makeComposioTrelloDef(exec),
    "one-drive": makeComposioOneDriveDef(exec),
    posthog: makeComposioPostHogDef(exec),
    attio: makeComposioAttioDef(exec),
    zoho: makeComposioZohoDef(exec),
    dropbox: makeComposioDropboxDef(exec),
    "microsoft-teams": makeComposioMicrosoftTeamsDef(exec),
    gumroad: makeComposioGumroadDef(exec),
    miro: makeComposioMiroDef(exec),
    exa: makeComposioExaDef(exec),
    mem0: makeComposioMem0Def(exec),
    cloudflare: makeComposioCloudflareDef(exec),
    vercel: makeComposioVercelDef(exec),
    supabase: makeComposioSupabaseDef(exec),
    stripe: makeComposioStripeDef(exec),
    "zoho-invoice": makeComposioZohoInvoiceDef(exec),
  }

  // Keep hand-written specs authoritative for custom previews, file staging, and
  // account-id resolution. Catalog-only tools are additive and use the same
  // approval-wrapped adapter, so new Composio actions cannot bypass the guard.
  if (catalogSpecs.length) {
    for (const def of Object.values(defs)) {
      if (def.auth.kind !== "composio") continue
      const auth = def.auth
      const existing = new Set(
        Object.keys(def.tools({ userId: "catalog", getAccessToken: async () => "" })),
      )
      const extras = catalogSpecs.filter(
        (spec) =>
          !existing.has(spec.slug) && spec.slug.startsWith(`${auth.toolkit.toUpperCase()}_`),
      )
      if (!extras.length) continue
      const catalogTools = createComposioTools({
        provider: def.id,
        toolkit: auth.toolkit,
        specs: extras,
        executor: exec,
      })
      const originalTools = def.tools
      def.tools = (ctx) => ({ ...originalTools(ctx), ...catalogTools(ctx) })
    }
  }
  return defs
}
