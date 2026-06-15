// Moved to @yomi/agent-core. This shim wires the sidecar-specific HTTP-based
// token provider and status lister so existing sidecar callers keep working.
import {
  ConnectorRegistry,
  type TokenProvider,
  type ConnectedProvidersLister,
} from "@yomi/agent-core"

export { ConnectorRegistry }
export type { ConnectorRegistryDeps } from "@yomi/agent-core"

function makeTokenProvider(): TokenProvider {
  return async (userId: string, provider: string): Promise<string> => {
    const backendUrl =
      process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
    const secret = process.env["SIDECAR_SECRET"] ?? ""
    const res = await fetch(
      `${backendUrl}/api/integrations/token/${encodeURIComponent(provider)}?userId=${encodeURIComponent(userId)}`,
      { headers: { "x-sidecar-secret": secret } },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Failed to get ${provider} token (${res.status})`)
    }
    const data = (await res.json()) as { accessToken: string }
    return data.accessToken
  }
}

function makeConnectedProvidersLister(): ConnectedProvidersLister {
  return async (userId: string): Promise<string[]> => {
    const backendUrl =
      process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
    const secret = process.env["SIDECAR_SECRET"] ?? ""
    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/status?userId=${encodeURIComponent(userId)}`,
        { headers: { "x-sidecar-secret": secret } },
      )
      if (res.ok) {
        const data = (await res.json()) as { connected: string[] }
        return data.connected
      }
    } catch {
      // best-effort
    }
    return []
  }
}

// Singleton registry — shared across the sidecar process lifetime
let _registry: ConnectorRegistry | null = null

export function getConnectorRegistry(): ConnectorRegistry {
  if (!_registry) {
    _registry = new ConnectorRegistry({
      getAccessToken: makeTokenProvider(),
      listConnectedProviders: makeConnectedProvidersLister(),
    })
  }
  return _registry
}

// Called from the query pipeline to inject the current user context
export async function initConnectorRegistry(userId: string): Promise<void> {
  const reg = getConnectorRegistry()
  await reg.init(userId)
}

// Called at sidecar startup to initialize the registry using the session token.
// Best-effort: failures are silently ignored.
export async function initConnectorRegistryFromSession(): Promise<void> {
  const sessionToken = process.env["YOMI_SESSION_TOKEN"]
  if (!sessionToken) return
  const backendUrl =
    process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
  try {
    const res = await fetch(`${backendUrl}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as { user?: { id: string } }
    const userId = data.user?.id
    if (userId) await initConnectorRegistry(userId)
  } catch {
    // best-effort
  }
}
