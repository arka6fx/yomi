import { app, BrowserWindow, shell } from "electron"
import path from "node:path"
import fs from "node:fs"

const BACKEND_URL = process.env["YOMI_BACKEND_URL"] ?? "https://api.yomi.app"
const CLIENT_ID = "yomi-desktop"

function tokenPath() {
  return path.join(app.getPath("userData"), "session.enc")
}

function loadToken(): string | null {
  try {
    const { safeStorage } = require("electron") as typeof import("electron")
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = fs.readFileSync(tokenPath())
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

function saveToken(token: string): void {
  const { safeStorage } = require("electron") as typeof import("electron")
  if (!safeStorage.isEncryptionAvailable()) return
  const enc = safeStorage.encryptString(token)
  fs.writeFileSync(tokenPath(), enc)
}

export function clearToken(): void {
  try { fs.unlinkSync(tokenPath()) } catch { /* no-op */ }
}

// Validate token by hitting a lightweight authenticated endpoint
async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/billing/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // 200 = active sub; 404 = authed but no sub — both mean token is valid
    return res.status !== 401
  } catch {
    // Network down in dev — assume token ok so we don't block offline use
    return true
  }
}

// Returns a valid session token, opening an auth window if needed.
export async function ensureAuthenticated(): Promise<string> {
  const stored = loadToken()
  if (stored) {
    const valid = await verifyToken(stored)
    if (valid) return stored
    clearToken()
  }
  return runDeviceCodeFlow()
}

async function runDeviceCodeFlow(): Promise<string> {
  const init = await fetch(`${BACKEND_URL}/api/auth/device-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID }),
  }).catch(() => { throw new Error("Cannot reach Yomi backend — check your connection") })

  if (!init.ok) throw new Error(`Device code request failed: ${init.status}`)

  const { device_code, user_code, verification_uri, interval } = await init.json() as {
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
  }

  const authWin = createAuthWindow(user_code, verification_uri)
  shell.openExternal(verification_uri)

  const token = await pollForToken(device_code, interval * 1000, authWin)
  saveToken(token)
  if (!authWin.isDestroyed()) authWin.close()
  return token
}

function createAuthWindow(userCode: string, verificationUri: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 340,
    frame: true,
    resizable: false,
    alwaysOnTop: true,
    title: "Sign in to Yomi",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0a0a;
    color:#e5e5e5;display:flex;flex-direction:column;align-items:center;
    justify-content:center;height:100vh;gap:18px;padding:32px;text-align:center}
  .logo{font-size:26px;font-weight:700;color:#fff;letter-spacing:-.04em}
  p{font-size:13px;color:#888;line-height:1.6}
  .code{font-size:30px;font-weight:700;letter-spacing:.14em;background:#141414;
    border:1px solid #2a2a2a;padding:14px 28px;border-radius:12px;color:#ffaf50;
    font-family:"SF Mono",Consolas,monospace}
  .waiting{font-size:11px;color:#555}
  a{font-size:12px;color:#ffaf50;text-decoration:none;padding:8px 20px;
    border:1px solid #ffaf5040;border-radius:8px;cursor:pointer}
  a:hover{background:#ffaf5012}
</style></head>
<body>
  <div class="logo">Yomi</div>
  <p>Your browser has been opened.<br>Sign in, then enter the code below.</p>
  <div class="code">${userCode}</div>
  <p class="waiting">Waiting for sign-in&hellip;</p>
  <a href="${verificationUri}" target="_blank">Open browser again</a>
</body></html>`

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

  // Closing the auth window before signing in quits the app
  win.on("closed", () => app.quit())

  return win
}

async function pollForToken(
  deviceCode: string,
  intervalMs: number,
  authWin: BrowserWindow,
): Promise<string> {
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    if (authWin.isDestroyed()) throw new Error("Auth cancelled")

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/device-code/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      })
      const data = await res.json() as { access_token?: string; error?: string }
      if (data.access_token) return data.access_token
      if (data.error === "expired_token") throw new Error("Authentication timed out — restart Yomi to try again")
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Authentication")) throw err
    }
  }
  throw new Error("Authentication timed out — restart Yomi to try again")
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }
