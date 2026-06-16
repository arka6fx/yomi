import { app, safeStorage } from "electron"
import path from "node:path"
import fs from "node:fs"

function loadDotEnv(): void {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "../../../.env"),
    path.join(__dirname, "../../../../.env"),
  ]
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "sidecar", ".env"))
  }
  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, "utf8")
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eqIdx = trimmed.indexOf("=")
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        const value = trimmed.slice(eqIdx + 1).trim()
        if (!(key in process.env)) process.env[key] = value
      }
      return
    } catch {
      // try next
    }
  }
}

loadDotEnv()

const configuredBackendUrl = process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"]
const defaultBackendUrl =
  !app.isPackaged && process.env["YOMI_DEV"] === "true"
    ? "http://localhost:3001"
    : "https://api.yomi.arka6fx.com"

export const BACKEND_URL = configuredBackendUrl ?? defaultBackendUrl

function tokenPath() {
  return path.join(app.getPath("userData"), "session.enc")
}

export function loadToken(): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = fs.readFileSync(tokenPath())
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const enc = safeStorage.encryptString(token)
  fs.writeFileSync(tokenPath(), enc)
}

export function clearToken(): void {
  try {
    fs.unlinkSync(tokenPath())
  } catch {
    /* no-op */
  }
}

// Returns the stored token if still valid, null if missing/expired.
export async function checkStoredToken(): Promise<string | null> {
  const stored = loadToken()
  if (!stored) return null
  try {
    const res = await fetch(`${BACKEND_URL}/api/user/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
    if (res.status === 401) {
      clearToken()
      return null
    }
    return stored
  } catch {
    // Network down — assume token valid so offline use works
    return stored
  }
}

// Runs the device-code OAuth flow (RFC 8628).
export async function startDeviceCodeFlow(
  provider: string | undefined,
  onDeviceUrl: (url: string) => void,
): Promise<string> {
  const init = await fetch(`${BACKEND_URL}/api/auth/device-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "yomi-desktop" }),
  }).catch(() => {
    throw new Error("Cannot reach Yomi backend — check your connection")
  })

  if (!init.ok) throw new Error(`Device code request failed: ${init.status}`)

  const { device_code, user_code, verification_uri, interval } = (await init.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
  }

  const url = new URL(verification_uri)
  url.searchParams.set("code", user_code)
  if (provider) url.searchParams.set("provider", provider)
  if (provider === "google") url.searchParams.set("fresh", "1")
  onDeviceUrl(url.toString())

  const token = await pollForToken(device_code, interval * 1000)
  saveToken(token)
  return token
}

async function pollForToken(deviceCode: string, intervalMs: number): Promise<string> {
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/device-code/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      })
      const data = (await res.json()) as { access_token?: string; error?: string }
      if (data.access_token) return data.access_token
      if (data.error === "expired_token")
        throw new Error("Authentication timed out — restart Yomi to try again")
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Authentication")) throw err
    }
  }
  throw new Error("Authentication timed out — restart Yomi to try again")
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
