// @yomi/agent-core — shared model provider, connectors, and lean agent loop.
// Used by the backend (server-side gateway).

export { createModel, embedText } from "./model.js"
export { resolveModelCap, resolveMaxTokens, type ModelCap } from "./model-caps.js"
export { RateLimitError, BillingError, ApiError } from "./model.js"

export { ConnectorRegistry, type ConnectorRegistryDeps } from "./connectors/registry.js"
export { GoogleGmailConnector } from "./connectors/google-gmail.js"
export { googleGmailDef, createGmailTools } from "./connectors/google-gmail-def.js"
export { googleCalendarDef, createCalendarTools } from "./connectors/google-calendar-def.js"
export { googleDriveDef, createDriveTools } from "./connectors/google-drive-def.js"
export { googleClassroomDef, createClassroomTools } from "./connectors/google-classroom-def.js"
export { googleTasksDef, createTasksTools } from "./connectors/google-tasks-def.js"
export { googleMeetDef, createMeetTools } from "./connectors/google-meet-def.js"
export { githubDef, createGitHubTools } from "./connectors/github-def.js"
export { notionDef, createNotionTools } from "./connectors/notion-def.js"
export { slackDef, createSlackTools } from "./connectors/slack-def.js"
export {
  linearDef,
  createLinearTools,
} from "./connectors/linear-def.js"
export { swiggyDef, SWIGGY_MCP_SERVERS, wrapOrderTools } from "./connectors/swiggy-def.js"
export { createMCPToolProvider, type MCPAuthProvider, type MCPServerConfig, type MCPToolProvider } from "./connectors/mcp-connector.js"
export { ALL_CONNECTOR_DEFS } from "./connectors/all-defs.js"

// Composio-backed connectors (approval-wrapped, per-connector flag).
export {
  createComposioTools,
  type ComposioExecutor,
  type ComposioToolSpec,
  type CreateComposioToolsOptions,
} from "./connectors/composio/adapter.js"
export {
  classifyAction,
  isReadAction,
  COMPOSIO_RISK_MAP,
  type ActionRisk,
  type WriteRisk,
} from "./connectors/composio/classification.js"
export { isComposioBacked, composioBackedConnectors } from "./connectors/composio/flags.js"
export {
  makeComposioLinearDef,
  linearComposioSpecs,
  LINEAR_TOOLKIT,
} from "./connectors/composio/linear.js"
export {
  makeComposioGitHubDef,
  githubComposioSpecs,
  GITHUB_TOOLKIT,
} from "./connectors/composio/github.js"
export {
  makeComposioSlackDef,
  slackComposioSpecs,
  SLACK_TOOLKIT,
} from "./connectors/composio/slack.js"
export {
  makeComposioNotionDef,
  notionComposioSpecs,
  NOTION_TOOLKIT,
} from "./connectors/composio/notion.js"
export {
  makeComposioGmailDef,
  gmailComposioSpecs,
  GMAIL_TOOLKIT,
} from "./connectors/composio/google-gmail.js"
export {
  makeComposioCalendarDef,
  calendarComposioSpecs,
  CALENDAR_TOOLKIT,
} from "./connectors/composio/google-calendar.js"
export {
  makeComposioDriveDef,
  driveComposioSpecs,
  DRIVE_TOOLKIT,
} from "./connectors/composio/google-drive.js"
export {
  makeComposioClassroomDef,
  classroomComposioSpecs,
  CLASSROOM_TOOLKIT,
} from "./connectors/composio/google-classroom.js"
export {
  makeComposioDocsDef,
  docsComposioSpecs,
  DOCS_TOOLKIT,
} from "./connectors/composio/google-docs.js"
export {
  makeComposioSheetsDef,
  sheetsComposioSpecs,
  SHEETS_TOOLKIT,
} from "./connectors/composio/google-sheets.js"
export {
  makeComposioSlidesDef,
  slidesComposioSpecs,
  SLIDES_TOOLKIT,
} from "./connectors/composio/google-slides.js"
export {
  makeComposioTasksDef,
  tasksComposioSpecs,
  TASKS_TOOLKIT,
} from "./connectors/composio/google-tasks.js"
export {
  makeComposioMeetDef,
  meetComposioSpecs,
  MEET_TOOLKIT,
} from "./connectors/composio/google-meet.js"
export {
  makeComposioMapsDef,
  mapsComposioSpecs,
  MAPS_TOOLKIT,
} from "./connectors/composio/google-maps.js"
export {
  makeComposioHubspotDef,
  hubspotComposioSpecs,
  HUBSPOT_TOOLKIT,
} from "./connectors/composio/hubspot.js"
export {
  makeComposioFirecrawlDef,
  firecrawlComposioSpecs,
  FIRECRAWL_TOOLKIT,
} from "./connectors/composio/firecrawl.js"
export {
  makeComposioDiscordDef,
  discordComposioSpecs,
  DISCORD_TOOLKIT,
} from "./connectors/composio/discord.js"
export {
  makeComposioWhatsAppDef,
  whatsappComposioSpecs,
  WHATSAPP_TOOLKIT,
} from "./connectors/composio/whatsapp.js"
export {
  makeComposioLinkedInDef,
  linkedinComposioSpecs,
  LINKEDIN_TOOLKIT,
} from "./connectors/composio/linkedin.js"
export {
  makeComposioOutlookDef,
  outlookComposioSpecs,
  OUTLOOK_TOOLKIT,
} from "./connectors/composio/outlook.js"
export {
  makeComposioFigmaDef,
  figmaComposioSpecs,
  FIGMA_TOOLKIT,
} from "./connectors/composio/figma.js"
export {
  makeComposioTodoistDef,
  todoistComposioSpecs,
  TODOIST_TOOLKIT,
} from "./connectors/composio/todoist.js"
export {
  makeComposioRedditDef,
  redditComposioSpecs,
  REDDIT_TOOLKIT,
} from "./connectors/composio/reddit.js"
export {
  makeComposioJiraDef,
  jiraComposioSpecs,
  JIRA_TOOLKIT,
} from "./connectors/composio/jira.js"
export {
  makeComposioAsanaDef,
  asanaComposioSpecs,
  ASANA_TOOLKIT,
} from "./connectors/composio/asana.js"
export {
  makeComposioYouTubeDef,
  youtubeComposioSpecs,
  YOUTUBE_TOOLKIT,
} from "./connectors/composio/youtube.js"
export {
  makeComposioZoomDef,
  zoomComposioSpecs,
  ZOOM_TOOLKIT,
} from "./connectors/composio/zoom.js"
export {
  makeComposioSalesforceDef,
  salesforceComposioSpecs,
  SALESFORCE_TOOLKIT,
} from "./connectors/composio/salesforce.js"
export {
  makeComposioFacebookDef,
  facebookComposioSpecs,
  FACEBOOK_TOOLKIT,
} from "./connectors/composio/facebook.js"
export {
  makeComposioInstagramDef,
  instagramComposioSpecs,
  INSTAGRAM_TOOLKIT,
} from "./connectors/composio/instagram.js"
export {
  makeComposioCalendlyDef,
  calendlyComposioSpecs,
  CALENDLY_TOOLKIT,
} from "./connectors/composio/calendly.js"
export {
  makeComposioTrelloDef,
  trelloComposioSpecs,
  TRELLO_TOOLKIT,
} from "./connectors/composio/trello.js"
export {
  makeComposioOneDriveDef,
  oneDriveComposioSpecs,
  ONE_DRIVE_TOOLKIT,
} from "./connectors/composio/one-drive.js"
export {
  makeComposioPostHogDef,
  posthogComposioSpecs,
  POSTHOG_TOOLKIT,
} from "./connectors/composio/posthog.js"
export {
  makeComposioAttioDef,
  attioComposioSpecs,
  ATTIO_TOOLKIT,
} from "./connectors/composio/attio.js"
export {
  makeComposioZohoDef,
  zohoComposioSpecs,
  ZOHO_TOOLKIT,
} from "./connectors/composio/zoho.js"
export {
  makeComposioDropboxDef,
  dropboxComposioSpecs,
  DROPBOX_TOOLKIT,
} from "./connectors/composio/dropbox.js"
export {
  makeComposioMicrosoftTeamsDef,
  microsoftTeamsComposioSpecs,
  MICROSOFT_TEAMS_TOOLKIT,
} from "./connectors/composio/microsoft-teams.js"
export {
  makeComposioGumroadDef,
  gumroadComposioSpecs,
  GUMROAD_TOOLKIT,
} from "./connectors/composio/gumroad.js"
export {
  makeComposioMem0Def,
  mem0ComposioSpecs,
  MEM0_TOOLKIT,
} from "./connectors/composio/mem0.js"
export {
  makeComposioDynamics365Def,
  dynamics365ComposioSpecs,
  DYNAMICS_365_TOOLKIT,
} from "./connectors/composio/dynamics-365.js"
export {
  makeComposioSerpapiDef,
  serpapiComposioSpecs,
  SERPAPI_TOOLKIT,
} from "./connectors/composio/serpapi.js"
export {
  makeComposioNeonDef,
  neonComposioSpecs,
  NEON_TOOLKIT,
} from "./connectors/composio/neon.js"
export {
  makeComposioFirefliesDef,
  firefliesComposioSpecs,
  FIREFLIES_TOOLKIT,
} from "./connectors/composio/fireflies.js"
export {
  makeComposioGooglePhotosDef,
  googlePhotosComposioSpecs,
  GOOGLE_PHOTOS_TOOLKIT,
} from "./connectors/composio/google-photos.js"
export {
  makeComposioGoogleAdsDef,
  googleAdsComposioSpecs,
  GOOGLE_ADS_TOOLKIT,
} from "./connectors/composio/google-ads.js"
export {
  makeComposioGoogleAnalyticsDef,
  googleAnalyticsComposioSpecs,
  GOOGLE_ANALYTICS_TOOLKIT,
} from "./connectors/composio/google-analytics.js"
export {
  makeComposioGoogleSearchConsoleDef,
  googleSearchConsoleComposioSpecs,
  GOOGLE_SEARCH_CONSOLE_TOOLKIT,
} from "./connectors/composio/google-search-console.js"
export {
  makeComposioGoogleCloudVisionDef,
  googleCloudVisionComposioSpecs,
  GOOGLE_CLOUD_VISION_TOOLKIT,
} from "./connectors/composio/google-cloud-vision.js"
export {
  makeComposioKaggleDef,
  kaggleComposioSpecs,
  KAGGLE_TOOLKIT,
} from "./connectors/composio/kaggle.js"
export { context7Def, context7Tools } from "./connectors/context7-def.js"
export {
  makeComposioMiroDef,
  miroComposioSpecs,
  MIRO_TOOLKIT,
} from "./connectors/composio/miro.js"
export {
  makeComposioExaDef,
  exaComposioSpecs,
  EXA_TOOLKIT,
} from "./connectors/composio/exa.js"
export {
  makeComposioCloudflareDef,
  cloudflareComposioSpecs,
  CLOUDFLARE_TOOLKIT,
} from "./connectors/composio/cloudflare.js"
export {
  makeComposioVercelDef,
  vercelComposioSpecs,
  VERCEL_TOOLKIT,
} from "./connectors/composio/vercel.js"
export {
  makeComposioSupabaseDef,
  supabaseComposioSpecs,
  SUPABASE_TOOLKIT,
} from "./connectors/composio/supabase.js"
export {
  makeComposioStripeDef,
  stripeComposioSpecs,
  STRIPE_TOOLKIT,
} from "./connectors/composio/stripe.js"
export {
  makeComposioZohoInvoiceDef,
  zohoInvoiceComposioSpecs,
  ZOHO_INVOICE_TOOLKIT,
} from "./connectors/composio/zoho-invoice.js"
export type {
  Connector,
  ConnectorStatus,
  TokenProvider,
  ConnectedProvidersLister,
  EmailSummary,
  EmailDetail,
  EmailDraft,
  SendResult,
} from "./connectors/types.js"
export type {
  ConnectorDef,
  ConnectorCategory,
  AuthConfig,
  ConnectorContext,
  ToolFactory,
  DeveloperSetup,
  ApiKeyField,
} from "./connectors/connector-def.js"

export { createConnectorTools } from "./tools.js"
export { createRecallTool, type SessionRecallResult, type RecallSearchFn } from "./recall.js"
export {
  createWebSearchTool,
  searchWeb,
  type WebSearchFn,
  type WebSearchResult,
  type WebSearchCitation,
} from "./web-search.js"
export {
  suggestIntegrationsFor,
  formatIntegrationSuggestions,
  type IntegrationSuggestion,
} from "./integration-catalog.js"
export {
  runAgentLoop,
  type AgentMessage,
  type UsageInfo,
  type RunAgentLoopOptions,
} from "./agent.js"
