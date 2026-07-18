import { and, eq } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import type { ConnectorDef } from "@yomi/agent-core"
import { encryptString, decryptString } from "./token-encryption.js"
import { composioBaseUrl } from "../connectors/composio-executor.js"

// Composio holds the OAuth grant and the tokens. Yomi's connection record stores
// only a REFERENCE to the connected account and its status — never access/refresh
// tokens. The reference lives (encrypted) in the existing mcp_connections row so
// the rest of the app treats a Composio connector like any other connection.

export type ComposioConnectionStatus = "initiated" | "active" | "failed"

export interface ComposioConnectionRef {
  kind: "composio"
  toolkit: string
  connectedAccountId: string | null
  status: ComposioConnectionStatus
}

export function encodeComposioRef(ref: ComposioConnectionRef): string {
  return encryptString(JSON.stringify(ref))
}

// Returns the reference if the stored blob is a Composio reference, else null
// (a native OAuth-token blob decodes to something without kind: "composio").
export function decodeComposioRef(ciphertext: string): ComposioConnectionRef | null {
  try {
    const parsed = JSON.parse(decryptString(ciphertext)) as Partial<ComposioConnectionRef>
    if (parsed && parsed.kind === "composio" && typeof parsed.toolkit === "string") {
      return {
        kind: "composio",
        toolkit: parsed.toolkit,
        connectedAccountId: parsed.connectedAccountId ?? null,
        status: parsed.status ?? "initiated",
      }
    }
  } catch {
    // not a composio ref (or wrong key) — treat as native
  }
  return null
}

function authConfigId(def: ConnectorDef): string {
  if (def.auth.kind !== "composio") throw new Error("not a composio connector")
  const env = def.auth.authConfigIdEnv
  const id = env ? process.env[env] : undefined
  if (!id) throw new Error(`${env ?? "Composio auth config id"} not set`)
  return id
}

function connectionDisplayName(ref: ComposioConnectionRef): string {
  const toolkit = ref.toolkit.charAt(0).toUpperCase() + ref.toolkit.slice(1)
  return ref.status === "active" ? `${toolkit} (Composio)` : `${toolkit} (connecting…)`
}

async function upsertComposioConnection(
  userId: string,
  provider: string,
  ref: ComposioConnectionRef,
): Promise<void> {
  const encrypted = encodeComposioRef(ref)
  const displayName = connectionDisplayName(ref)
  const lastSyncAt = ref.status === "active" ? new Date() : null
  await db
    .insert(mcpConnections)
    .values({ userId, provider, oauthTokens: encrypted, scopes: [], displayName, lastSyncAt })
    .onConflictDoUpdate({
      target: [mcpConnections.userId, mcpConnections.provider],
      set: { oauthTokens: encrypted, scopes: [], displayName, lastSyncAt, updatedAt: new Date() },
    })
}

// Start a Composio connection: create a link, persist an `initiated` reference,
// and return the URL the dashboard sends the user to. Composio white-labels this
// page (and, for own-OAuth configs, keeps Yomi on the consent screen).
export async function initiateComposioConnection(
  userId: string,
  def: ConnectorDef,
  opts?: { callbackUrl?: string; fetchImpl?: typeof fetch },
): Promise<{ redirectUrl: string; connectedAccountId: string | null }> {
  if (def.auth.kind !== "composio") throw new Error("not a composio connector")
  const apiKey = process.env["COMPOSIO_API_KEY"]
  if (!apiKey) throw new Error("COMPOSIO_API_KEY not set")

  const doFetch = opts?.fetchImpl ?? fetch
  const res = await doFetch(`${composioBaseUrl()}/api/v3/connected_accounts/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      auth_config_id: authConfigId(def),
      user_id: userId,
      ...(opts?.callbackUrl ? { callback_url: opts.callbackUrl } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`Composio link create → status ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const body = (await res.json()) as { redirect_url?: string; connected_account_id?: string }
  const redirectUrl = body.redirect_url
  if (!redirectUrl) throw new Error("Composio did not return a redirect URL")

  await upsertComposioConnection(userId, def.id, {
    kind: "composio",
    toolkit: def.auth.toolkit,
    connectedAccountId: body.connected_account_id ?? null,
    status: "initiated",
  })

  return { redirectUrl, connectedAccountId: body.connected_account_id ?? null }
}

// Mark a previously-initiated Composio connection active (called after Composio
// redirects the user back). Idempotent upsert of the reference.
export async function markComposioConnectionActive(
  userId: string,
  def: ConnectorDef,
  connectedAccountId: string | null,
): Promise<void> {
  if (def.auth.kind !== "composio") throw new Error("not a composio connector")
  await upsertComposioConnection(userId, def.id, {
    kind: "composio",
    toolkit: def.auth.toolkit,
    connectedAccountId,
    status: "active",
  })
}

// Whether a stored connection row for this provider is Composio-backed.
export async function isComposioConnection(userId: string, provider: string): Promise<boolean> {
  const [row] = await db
    .select({ oauthTokens: mcpConnections.oauthTokens })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.provider, provider)))
    .limit(1)
  if (!row) return false
  return decodeComposioRef(row.oauthTokens) !== null
}
