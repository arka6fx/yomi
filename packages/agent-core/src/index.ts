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
export { googleContactsDef, createContactsTools } from "./connectors/google-contacts-def.js"
export { googleMeetDef, createMeetTools } from "./connectors/google-meet-def.js"
export { githubDef, createGitHubTools } from "./connectors/github-def.js"
export { notionDef, createNotionTools } from "./connectors/notion-def.js"
export { slackDef, createSlackTools } from "./connectors/slack-def.js"
export {
  linearDef,
  linearApiKeyDef,
  createLinearTools,
  createLinearApiKeyTools,
} from "./connectors/linear-def.js"
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
  makeComposioTasksDef,
  tasksComposioSpecs,
  TASKS_TOOLKIT,
} from "./connectors/composio/google-tasks.js"
export {
  makeComposioContactsDef,
  contactsComposioSpecs,
  CONTACTS_TOOLKIT,
} from "./connectors/composio/google-contacts.js"
export {
  makeComposioMeetDef,
  meetComposioSpecs,
  MEET_TOOLKIT,
} from "./connectors/composio/google-meet.js"
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
export {
  runAgentLoop,
  type AgentMessage,
  type UsageInfo,
  type RunAgentLoopOptions,
} from "./agent.js"
