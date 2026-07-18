import { createHash, randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import { encryptTokens, type OAuthTokens } from "../../services/token-encryption.js"

const SWIGGY_AUTH_BASE = "https://mcp.swiggy.com/auth"

function backendUrl(): string {
  return process.env.BETTER_AUTH_BASE_URL ?? process.env.BACKEND_URL ?? "http://localhost:3001"
}

function appUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
}

// Generate PKCE code challenge from a code verifier (S256 method).
function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

// Generate a cryptographically random code verifier (43-128 chars).
function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url").slice(0, 128)
}

// Dynamic client registration against Swiggy's OAuth server.
interface SwiggyClientRegistration {
  client_id: string
  client_secret?: string
  client_id_issued_at?: number
  client_secret_expires_at?: number
}

async function registerClient(redirectUri: string): Promise<SwiggyClientRegistration> {
  const body = new URLSearchParams({
    redirect_uris: redirectUri,
    token_endpoint_auth_method: "none",
    grant_types: "authorization_code",
    response_types: "code",
  })

  const res = await fetch(`${SWIGGY_AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => "")
    throw new Error(`Swiggy client registration failed (${res.status}): ${msg.slice(0, 200)}`)
  }

  return res.json() as Promise<SwiggyClientRegistration>
}

// Stores PKCE session data (code verifier + registered client id) for the callback.
const pkceSessions = new Map<string, { codeVerifier: string; clientId: string; userId: string; ts: number }>()

// Prune stale PKCE sessions every 5 minutes.
setInterval(() => {
  const now = Date.now()
  for (const [key, session] of pkceSessions) {
    if (now - session.ts > 10 * 60 * 1000) pkceSessions.delete(key)
  }
}, 5 * 60 * 1000)

// Build the Swiggy OAuth authorization URL.
export async function buildSwiggyAuthUrl(userId: string): Promise<string> {
  const redirectUri = `${backendUrl()}/api/integrations/callback/swiggy`
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = pkceChallenge(codeVerifier)

  // Register a dynamic client for this session.
  const registration = await registerClient(redirectUri)
  const clientId = registration.client_id
  const state = randomBytes(32).toString("hex")

  // Store the PKCE session data for the callback.
  pkceSessions.set(state, { codeVerifier, clientId, userId, ts: Date.now() })

  const url = new URL(`${SWIGGY_AUTH_BASE}/authorize`)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)

  return url.toString()
}

// Handle the Swiggy OAuth callback: exchange code for token and store it.
export async function handleSwiggyCallback(
  code: string,
  state: string,
): Promise<{ redirectTo: string }> {
  // Validate state and retrieve PKCE session.
  const session = pkceSessions.get(state)
  if (!session) {
    return { redirectTo: `${appUrl()}/dashboard?integration_error=invalid_state` }
  }
  if (Date.now() - session.ts > 10 * 60 * 1000) {
    pkceSessions.delete(state)
    return { redirectTo: `${appUrl()}/dashboard?integration_error=state_expired` }
  }
  pkceSessions.delete(state)

  const { codeVerifier, clientId, userId } = session
  const redirectUri = `${backendUrl()}/api/integrations/callback/swiggy`

  // Exchange authorization code for access token.
  let tokens: OAuthTokens
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    })

    const res = await fetch(`${SWIGGY_AUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    if (!res.ok) {
      const msg = await res.text().catch(() => "")
      throw new Error(`Token exchange failed (${res.status}): ${msg.slice(0, 200)}`)
    }

    const data = (await res.json()) as {
      access_token?: string
      expires_in?: number
      token_type?: string
    }
    if (!data.access_token) throw new Error("No access_token in response")

    tokens = {
      accessToken: data.access_token,
      refreshToken: null,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      tokenType: data.token_type,
      scope: undefined,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token exchange failed"
    console.error("[swiggy/oauth] callback error:", msg)
    return { redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent(msg)}` }
  }

  // Persist encrypted tokens.
  let encrypted: string
  try {
    encrypted = encryptTokens(tokens)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token encryption failed"
    console.error("[swiggy/oauth] encrypt error:", msg)
    return { redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent(msg)}` }
  }

  try {
    await db
      .insert(mcpConnections)
      .values({
        userId,
        provider: "swiggy",
        oauthTokens: encrypted,
        scopes: [],
        expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
        displayName: "Swiggy",
        lastSyncAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [mcpConnections.userId, mcpConnections.provider],
        set: {
          oauthTokens: encrypted,
          scopes: [],
          expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
          displayName: "Swiggy",
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "database error"
    console.error("[swiggy/oauth] db upsert error:", msg)
    return {
      redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent("Failed to save connection. Try reconnecting.")}`,
    }
  }

  return { redirectTo: `${appUrl()}/dashboard?integration_success=swiggy` }
}
