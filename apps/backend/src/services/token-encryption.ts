import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null // unix ms
  tokenType?: string
  scope?: string
}

const ALGO = "aes-256-gcm"

function parseKey(hex: string | undefined, label: string): Buffer {
  if (!hex || hex.length !== 64) throw new Error(`${label} must be a 64-char hex string`)
  return Buffer.from(hex, "hex")
}

// Primary key used for all new writes.
function getKey(): Buffer {
  return parseKey(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY")
}

// All keys valid for DECRYPTION: primary first, then any comma-separated
// ENCRYPTION_KEY_FALLBACKS. This lets a token encrypted under a previous/other
// key (e.g. a different environment sharing the same database, or a rotated key)
// still be read without forcing the user to reconnect. New tokens always
// re-encrypt under the primary key.
function getDecryptKeys(): Buffer[] {
  const keys: Buffer[] = [getKey()]
  const fallbacks = process.env.ENCRYPTION_KEY_FALLBACKS
  if (fallbacks) {
    for (const hex of fallbacks.split(",").map((s) => s.trim()).filter(Boolean)) {
      try {
        keys.push(parseKey(hex, "ENCRYPTION_KEY_FALLBACKS entry"))
      } catch {
        // Skip malformed fallback entries rather than failing all decryption.
      }
    }
  }
  return keys
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
  const buf = Buffer.from(ciphertext, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)

  let lastErr: unknown
  for (const key of getDecryptKeys()) {
    try {
      const decipher = createDecipheriv(ALGO, key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
      return JSON.parse(plain) as OAuthTokens
    } catch (err) {
      // GCM auth tag mismatch (wrong key) → try the next candidate key.
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("decryption failed")
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
