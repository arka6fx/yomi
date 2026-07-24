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
  // User-added MCP servers (name/URL/optional API key), injected by the host.
  // Decryption of any stored API key happens in the host's implementation of
  // this function — agent-core never touches the encryption key directly,
  // same layering as getAccessToken already returning decrypted tokens.
  listCustomMcpServers?: (
    userId: string,
  ) => Promise<{ id: string; name: string; url: string; apiKey: string | null }[]>
}

// Registry maps provider name → connector instance for the current user.
// Re-created whenever the userId changes or integrations are refreshed.
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>()
  private defTools: ToolSet = {}
  private mcpTools: ToolSet = {}
  private customMcpTools: ToolSet = {}
  // Same tools as defTools/mcpTools, kept indexed by connector id too (defTools/
  // mcpTools are the flat merge used by the "load everything" path). Lets a caller
  // that only needs a subset of connected connectors — see getToolsForConnectors —
  // avoid sending every connected service's schema on every turn.
  private defToolsByConnector = new Map<string, ToolSet>()
  private mcpToolsByConnector = new Map<string, ToolSet>()
  private connectedDefMeta = new Map<string, { name: string; description: string }>()
  private connectedDefIds: Set<string> = new Set()
  // Names of connected connectors skipped because they need a Node runtime the
  // current host lacks (Workers). Surfaced so the agent can tell the user the
  // service works from the backend.
  private desktopOnlyNames: string[] = []
  private userId: string | null = null
  private connectedProviders: Set<string> = new Set()
  private lastRefreshed = 0
  private mcpConnectedIds: string[] = []

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
    await this.buildConnectors()
  }

  private async buildConnectors(): Promise<void> {
    if (!this.userId) return
    this.connectors.clear()
    this.defTools = {}
    this.mcpTools = {}
    this.customMcpTools = {}
    this.defToolsByConnector.clear()
    this.mcpToolsByConnector.clear()
    this.connectedDefMeta.clear()
    this.connectedDefIds.clear()
    this.desktopOnlyNames = []
    this.mcpConnectedIds = []

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
        this.connectedDefMeta.set(def.id, { name: def.name, description: def.description })
        if (def.isMCPBased && def.connectMCP) {
          // MCP defs: store for lazy loading, don't call tools() yet
          this.mcpConnectedIds.push(def.id)
        } else {
          const tools = def.tools({
            userId: this.userId,
            getAccessToken: this.deps.getAccessToken,
            createPendingAction: this.deps.createPendingAction,
          })
          Object.assign(this.defTools, tools)
          this.defToolsByConnector.set(def.id, tools)
        }
      }
    }
  }

  // Lazily connects MCP servers for all connected MCP-based defs and merges
  // their tools. Safe to call multiple times — MCP tools are loaded once.
  async loadMCPTools(): Promise<void> {
    if (this.userId && this.mcpConnectedIds.length > 0 && Object.keys(this.mcpTools).length === 0) {
      for (const baseDef of ALL_CONNECTOR_DEFS) {
        if (!this.mcpConnectedIds.includes(baseDef.id)) continue
        const def = baseDef
        if (def.isMCPBased && def.connectMCP) {
          try {
            const tools = await def.connectMCP({
              userId: this.userId,
              getAccessToken: this.deps.getAccessToken,
              createPendingAction: this.deps.createPendingAction,
            })
            Object.assign(this.mcpTools, tools)
            this.mcpToolsByConnector.set(def.id, tools)
          } catch (err) {
            console.error(`[registry] MCP connect failed for ${def.id}:`, err)
          }
        }
      }
    }

    if (this.userId && this.deps.listCustomMcpServers && Object.keys(this.customMcpTools).length === 0) {
      try {
        const servers = await this.deps.listCustomMcpServers(this.userId)
        if (servers.length > 0) {
          const { createMCPToolProvider } = await import("./mcp-connector.js")
          const { resolvesToDisallowedAddress } = await import("./ssrf-guard.js")
          for (const server of servers) {
            try {
              // Re-check at connect time, not just at insert time (the backend's
              // POST /api/custom-mcp route already does this too) — DNS for the
              // same hostname can change between when a user adds a server and
              // when the agent actually connects to it.
              const hostname = new URL(server.url).hostname
              if (await resolvesToDisallowedAddress(hostname)) {
                console.error(`[registry] custom MCP server ${server.id} resolves to a disallowed address, skipping`)
                continue
              }
              const provider = createMCPToolProvider()
              const tools = await provider.loadTools({
                userId: this.userId,
                servers: [{ id: server.id, url: server.url }],
                authProvider: {
                  async getHeaders(): Promise<Record<string, string>> {
                    return server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}
                  },
                },
              })
              Object.assign(this.customMcpTools, tools)
            } catch (err) {
              console.error(`[registry] custom MCP server load failed for ${server.id}:`, err)
            }
          }
        }
      } catch (err) {
        console.error(`[registry] listCustomMcpServers failed:`, err)
      }
    }
  }

  // Returns the merged AI SDK tool set from all connected ConnectorDefs.
  // This is the primary path for the agent loop. Includes both native and
  // already-loaded MCP tools.
  getAllDefTools(): ToolSet {
    return { ...this.defTools, ...this.mcpTools, ...this.customMcpTools }
  }

  // id/name/description for every connected connector — enough for a cheap
  // classifier to decide relevance without seeing any tool schemas. Excludes
  // MCP-based defs not yet loaded (loadMCPTools() populates their metadata too,
  // via the same connectedDefMeta map buildConnectors() already writes to).
  getConnectorSummaries(): { id: string; name: string; description: string }[] {
    return [...this.connectedDefMeta.entries()].map(([id, meta]) => ({ id, ...meta }))
  }

  // Merged tools for just the given connector ids (plus custom MCP servers,
  // always included — few in number and deliberately added by the user, not
  // part of the catalog-bloat problem this exists to solve). Unknown ids are
  // silently ignored. Used by the agent loop to load only what a turn's cheap
  // relevance classifier picked, instead of every connected connector's tools.
  getToolsForConnectors(ids: string[]): ToolSet {
    const tools: ToolSet = { ...this.customMcpTools }
    for (const id of ids) {
      Object.assign(tools, this.defToolsByConnector.get(id))
      Object.assign(tools, this.mcpToolsByConnector.get(id))
    }
    return tools
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
    return [
      ...new Set([...this.connectors.keys(), ...this.connectedDefIds]),
    ]
  }

  // Returns IDs of MCP-based defs that are connected but not yet loaded.
  getMCPConnectedIds(): string[] {
    return [...this.mcpConnectedIds]
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
