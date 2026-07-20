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
  runAgentLoop,
  type AgentMessage,
  type UsageInfo,
  type RunAgentLoopOptions,
} from "./agent.js"
