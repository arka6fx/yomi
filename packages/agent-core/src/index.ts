// @yomi/agent-core — shared model provider, connectors, and lean agent loop.
// Used by the sidecar (desktop chat) and the backend (server-side gateway).

export { createModel } from "./model.js"

export {
  ConnectorRegistry,
  type ConnectorRegistryDeps,
} from "./connectors/registry.js"
export { GoogleGmailConnector } from "./connectors/google-gmail.js"
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

export { createConnectorTools } from "./tools.js"
export {
  runAgentLoop,
  type AgentMessage,
  type RunAgentLoopOptions,
} from "./agent.js"
