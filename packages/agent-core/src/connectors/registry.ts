import type { ToolSet } from "ai"
import { GoogleGmailConnector } from "./google-gmail.js"
import { ALL_CONNECTOR_DEFS } from "./all-defs.js"
import type {
  Connector,
  ConnectorStatus,
  TokenProvider,
  ConnectedProvidersLister,
} from "./types.js"
import type { ConnectorContext, ConnectorDef } from "./connector-def.js"
import { isComposioBacked } from "./composio/flags.js"

// Dependencies injected so the registry runs in the backend
// (in-process from the DB).
export interface ConnectorRegistryDeps {
  getAccessToken: TokenProvider
  listConnectedProviders: ConnectedProvidersLister
  createPendingAction?: ConnectorContext["createPendingAction"]
  // Set by hosts that can't run Node-only connectors (the Cloudflare Workers
  // backend). When true, defs flagged `requiresNodeRuntime` are skipped so the
  // agent never advertises a tool that would fail at execution. Defaults to
  // false — Node keeps every connector.
  excludeNodeOnly?: boolean
  // Composio-backed defs keyed by connector id, injected by the host (the backend
  // wires each with a real Composio executor). A connector here is used ONLY when
  // it is also flagged via COMPOSIO_CONNECTORS; otherwise the native def in
  // ALL_CONNECTOR_DEFS is kept. This is the per-connector native↔composio switch.
  composioDefs?: Record<string, ConnectorDef>
}

// Registry maps provider name → connector instance for the current user.
// Re-created whenever the userId changes or integrations are refreshed.
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>()
  private defTools: ToolSet = {}
  private connectedDefIds: Set<string> = new Set()
  // Names of connected connectors skipped because they need a Node runtime the
  // current host lacks (Workers). Surfaced so the agent can tell the user the
  // service works from the backend.
  private desktopOnlyNames: string[] = []
  private userId: string | null = null
  private connectedProviders: Set<string> = new Set()
  private lastRefreshed = 0

  constructor(private readonly deps: ConnectorRegistryDeps) {}

  // Call this when the userId is known (after auth). Loads connected integrations.
  async init(userId: string): Promise<void> {
    this.userId = userId
    await this.refresh()
  }

  // Task 3's replay executor needs the current user to rebuild ungated tools.
  getUserId(): string | null {
    return this.userId
  }

  // Task 3's replay executor needs the token provider to rebuild ungated tools.
  getTokenProvider(): TokenProvider {
    return this.deps.getAccessToken
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
    this.desktopOnlyNames = []

    // Legacy Gmail path: stored as "google" in mcp_connections for existing rows.
    // Kept so registry.get("google") still works.
    if (this.connectedProviders.has("google")) {
      this.connectors.set("google", new GoogleGmailConnector(this.userId, this.deps.getAccessToken))
    }

    // Def-based path: iterate all registered ConnectorDefs and load tools for
    // any that the user has connected (provider key matches mcp_connections row).
    for (const baseDef of ALL_CONNECTOR_DEFS) {
      // Per-connector backend selection: prefer the injected Composio def when the
      // connector is flagged, else keep the native (hand-rolled) def.
      const composioDef = this.deps.composioDefs?.[baseDef.id]
      const def = composioDef && isComposioBacked(baseDef.id) ? composioDef : baseDef

      if (this.deps.excludeNodeOnly && def.requiresNodeRuntime) {
        if (this.connectedProviders.has(def.id)) this.desktopOnlyNames.push(def.name)
        continue
      }
      if (this.connectedProviders.has(def.id)) {
        this.connectedDefIds.add(def.id)
        const tools = def.tools({
          userId: this.userId,
          getAccessToken: this.deps.getAccessToken,
          createPendingAction: this.deps.createPendingAction,
        })
        Object.assign(this.defTools, tools)
      }
    }
  }

  // Returns the merged AI SDK tool set from all connected ConnectorDefs.
  // This is the primary path for the agent loop.
  getAllDefTools(): ToolSet {
    return this.defTools
  }

  // Names of connected connectors that were skipped on this host because they
  // require a Node runtime (only set when excludeNodeOnly is true). The agent
  // uses this to note services only available in the desktop client.
  getDesktopOnlyConnected(): string[] {
    return [...this.desktopOnlyNames]
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
