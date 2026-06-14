import type { ToolSet } from "ai"
import { GoogleGmailConnector } from "./google-gmail.js"
import { googleGmailDef } from "./google-gmail-def.js"
import type {
  Connector,
  ConnectorStatus,
  TokenProvider,
  ConnectedProvidersLister,
} from "./types.js"

// Dependencies injected so the registry runs in both runtimes: the sidecar
// fetches tokens/status over HTTP from the backend; the backend resolves them
// in-process from the DB.
export interface ConnectorRegistryDeps {
  getAccessToken: TokenProvider
  listConnectedProviders: ConnectedProvidersLister
}

// Registry maps provider name → connector instance for the current user.
// Re-created whenever the userId changes or integrations are refreshed.
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>()
  private defTools: ToolSet = {}
  private connectedDefIds: Set<string> = new Set()
  private userId: string | null = null
  private connectedProviders: Set<string> = new Set()
  private lastRefreshed = 0

  constructor(private readonly deps: ConnectorRegistryDeps) {}

  // Call this when the userId is known (after auth). Loads connected integrations.
  async init(userId: string): Promise<void> {
    this.userId = userId
    await this.refresh()
  }

  // Fetch current integration status and rebuild the connector map.
  async refresh(): Promise<void> {
    if (!this.userId) return
    try {
      const connected = await this.deps.listConnectedProviders(this.userId)
      this.connectedProviders = new Set(connected)
    } catch {
      // best-effort — connectors still work if the registry can't refresh
    }
    this.lastRefreshed = Date.now()
    this.buildConnectors()
  }

  private buildConnectors(): void {
    if (!this.userId) return
    this.connectors.clear()
    this.defTools = {}
    this.connectedDefIds.clear()

    if (this.connectedProviders.has("google")) {
      // Legacy path — kept for any code that calls registry.get("google") directly
      this.connectors.set(
        "google",
        new GoogleGmailConnector(this.userId, this.deps.getAccessToken),
      )
      // Def path — tools come from the ConnectorDef ToolFactory
      this.connectedDefIds.add("google-gmail")
      const tools = googleGmailDef.tools({
        userId: this.userId,
        getAccessToken: this.deps.getAccessToken,
      })
      Object.assign(this.defTools, tools)
    }
    // Additional defs (Calendar, GitHub, Notion, etc.) are registered here
    // in subsequent checkpoints by checking their provider key in connectedProviders.
  }

  // Returns the merged AI SDK tool set from all connected ConnectorDefs.
  // This is the primary path for the agent loop.
  getAllDefTools(): ToolSet {
    return this.defTools
  }

  get(provider: string): Connector | null {
    return this.connectors.get(provider) ?? null
  }

  // Returns all connected provider/def IDs (legacy + def-based).
  getConnected(): string[] {
    return [...new Set([...this.connectors.keys(), ...this.connectedDefIds])]
  }

  getStatus(provider: string): ConnectorStatus {
    const conn = this.connectors.get(provider)
    if (!conn) return { connected: false }
    return { connected: true, displayName: conn.displayName, lastSyncAt: null }
  }

  isConnected(provider: string): boolean {
    return this.connectors.has(provider) || this.connectedDefIds.has(provider)
  }
}
