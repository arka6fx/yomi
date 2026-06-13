import { GoogleGmailConnector } from "./google-gmail.js"
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
    if (this.connectedProviders.has("google")) {
      this.connectors.set(
        "google",
        new GoogleGmailConnector(this.userId, this.deps.getAccessToken),
      )
    }
    // Future: notion, slack, github, etc.
  }

  get(provider: string): Connector | null {
    return this.connectors.get(provider) ?? null
  }

  getConnected(): string[] {
    return Array.from(this.connectors.keys())
  }

  getStatus(provider: string): ConnectorStatus {
    const conn = this.connectors.get(provider)
    if (!conn) return { connected: false }
    return { connected: true, displayName: conn.displayName, lastSyncAt: null }
  }

  isConnected(provider: string): boolean {
    return this.connectors.has(provider)
  }
}
