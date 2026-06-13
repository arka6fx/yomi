// Moved to @yomi/agent-core. Re-export shim keeps existing sidecar imports working.
export type {
  Connector,
  ConnectorStatus,
  TokenProvider,
  ConnectedProvidersLister,
  EmailSummary,
  EmailDetail,
  EmailDraft,
  SendResult,
} from "@yomi/agent-core"
