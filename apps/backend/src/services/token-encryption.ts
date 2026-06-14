import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null // unix ms
  tokenType?: string
  scope?: string
}

const ALGO = "aes-256-gcm"

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) throw new Error("ENCRYPTION_KEY must be a 64-char hex string")
  return Buffer.from(hex, "hex")
}

// Returns base64(iv + authTag + ciphertext)
export function encryptTokens(tokens: OAuthTokens): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const plain = JSON.stringify(tokens)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  // layout: 12 bytes iv | 16 bytes tag | N bytes ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decryptTokens(ciphertext: string): OAuthTokens {
  const key = getKey()
  const buf = Buffer.from(ciphertext, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
  return JSON.parse(plain) as OAuthTokens
}

// Refresh a Google access token using the stored refresh token.
// Re-encrypts and persists the result, then returns the updated tokens.
export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  const clientId = process.env.GOOGLE_INTEGRATIONS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_INTEGRATIONS_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials not configured")

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token refresh failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
    token_type?: string
    scope?: string
  }

  return {
    accessToken: data.access_token,
    refreshToken, // Google only rotates refresh tokens rarely; keep existing
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  }
}
