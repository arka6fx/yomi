// @yomi/agent-core — shared model provider, connectors, and lean agent loop.
// Used by the sidecar (desktop chat) and the backend (server-side gateway).

export { createModel } from "./model.js"

export {
  ConnectorRegistry,
  type ConnectorRegistryDeps,
} from "./connectors/registry.js"
export { GoogleGmailConnector } from "./connectors/google-gmail.js"
export { googleGmailDef, createGmailTools } from "./connectors/google-gmail-def.js"
export { googleCalendarDef, createCalendarTools } from "./connectors/google-calendar-def.js"
export { googleDriveDef, createDriveTools } from "./connectors/google-drive-def.js"
export { githubDef, createGitHubTools } from "./connectors/github-def.js"
export { ALL_CONNECTOR_DEFS } from "./connectors/all-defs.js"
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
  type RunAgentLoopOptions,
} from "./agent.js"
