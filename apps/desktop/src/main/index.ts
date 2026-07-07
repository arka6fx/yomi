import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} from "electron"
import type { Rectangle } from "electron"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { SidecarManager } from "./sidecar"
import { checkStoredToken, startDeviceCodeFlow, clearToken, loadToken, BACKEND_URL } from "./auth"
import {
  initHotkey,
  enableHotkeys,
  disableHotkeys,
  suspendHotkeys,
  resumeHotkeys,
  triggerEscape,
  triggerVoiceMode,
  triggerTextMode,
  triggerStopListening,
} from "./hotkey"
import { initSidecarIpc } from "./ipc"
import { initAutoUpdater, downloadUpdate, installUpdate } from "./updater"

// Transparent frameless windows need software compositing on some GPU/driver combos
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu-program-cache")
  app.setAppUserModelId("com.yomi.app")
}

let overlayWin: BrowserWindow | null = null
let sidecarStarted = false // Sidecar + IPC + hotkeys initialised (once ever)
let sidecarInstance: SidecarManager | null = null
let overlayHitRegions: { x: number; y: number; width: number; height: number }[] = []
let overlayIgnoringMouse = false
let overlayLogicalPos = { x: 0, y: 0 }
const COMPACT_OVERLAY_W = 880
const MIN_OVERLAY_H = 96

function compactOverlayBounds(height = MIN_OVERLAY_H): Rectangle {
  const { x, y, width, height: workHeight } = screen.getPrimaryDisplay().workArea
  const nextHeight = Math.min(
    Math.max(height, MIN_OVERLAY_H),
    Math.max(MIN_OVERLAY_H, workHeight - 16),
  )
  return {
    x: x + Math.round((width - COMPACT_OVERLAY_W) / 2),
    y: y + 8,
    width: COMPACT_OVERLAY_W,
    height: nextHeight,
  }
}

function resizeOverlay(w: number, h: number): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  // Use actual window bounds — native CSS app-region drag moves the window at OS level
  // without firing mousemove in the renderer, so overlayLogicalPos can be stale.
  const currentBounds = overlayWin.getBounds()
  const workArea = screen.getDisplayMatching(currentBounds).workArea
  const nextWidth = Math.min(Math.max(240, Math.round(w)), Math.max(240, workArea.width))
  // Pin y at current position — never slide the window up. Cap height at the space
  // available below so the window doesn't bleed off the screen bottom.
  const y = Math.max(currentBounds.y, workArea.y)
  const availBelow = Math.max(MIN_OVERLAY_H, workArea.y + workArea.height - y - 8)
  const nextHeight = Math.min(Math.max(MIN_OVERLAY_H, Math.round(h)), availBelow)
  const x = Math.min(Math.max(currentBounds.x, workArea.x), workArea.x + workArea.width - nextWidth)
  overlayLogicalPos = { x, y }
  overlayWin.setBounds({ x, y, width: nextWidth, height: nextHeight }, false)
}

function setOverlayMouseIgnored(ignored: boolean): void {
  if (!overlayWin || overlayWin.isDestroyed() || overlayIgnoringMouse === ignored) return
  overlayIgnoringMouse = ignored
  if (ignored) overlayWin.setIgnoreMouseEvents(true, { forward: true })
  else overlayWin.setIgnoreMouseEvents(false)
}

function updateOverlayMousePassthrough(): void {
  if (!overlayWin || overlayWin.isDestroyed() || !overlayWin.isVisible()) return
  if (overlayHitRegions.length === 0) {
    setOverlayMouseIgnored(false)
    return
  }
  const cursor = screen.getCursorScreenPoint()
  const bounds = overlayWin.getBounds()
  const localX = cursor.x - bounds.x
  const localY = cursor.y - bounds.y
  const insideYomi = overlayHitRegions.some(
    (r) => localX >= r.x && localX <= r.x + r.width && localY >= r.y && localY <= r.y + r.height,
  )
  setOverlayMouseIgnored(!insideYomi)
}

function openTrustedExternal(rawUrl: string): void {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:" && url.hostname !== "localhost") return
    shell.openExternal(url.toString())
  } catch {
    console.warn("[yomi] blocked invalid external url")
  }
}

app.whenReady().then(async () => {
  // Position overlay at top-center of primary display
  const initialBounds = compactOverlayBounds()
  overlayLogicalPos = { x: initialBounds.x, y: initialBounds.y }

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "../../build/icon.ico")
  const appIcon = nativeImage.createFromPath(iconPath)

  overlayWin = new BrowserWindow({
    ...initialBounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    icon: appIcon.isEmpty() ? iconPath : appIcon,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  overlayWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  overlayWin.webContents.on("will-navigate", (event) => event.preventDefault())
  overlayWin.setAlwaysOnTop(true, "screen-saver")
  overlayWin.setContentProtection(true)
  overlayWin.setVisibleOnAllWorkspaces(true)
  overlayWin.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase()
    if ((input.control || input.meta) && (key === "r" || key === "f5")) {
      event.preventDefault()
    }
  })

  // Grant mic + screen-capture permissions so renderer getUserMedia (voice + system
  // audio loopback) actually resolves — without these, getUserMedia rejects silently.
  const ses = overlayWin.webContents.session
  const ALLOWED_MEDIA = new Set(["media", "audioCapture", "videoCapture", "display-capture"])
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_MEDIA.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_MEDIA.has(permission))
  // getDisplayMedia path (some Chromium versions route loopback here).
  ses.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
      .catch(() => callback({}))
  })

  // ── Overlay window control IPCs (no auth required) ─────────────────────────

  // Renderer-side ESC fallback — fires when globalShortcut("Escape") fails to register.
  // triggerEscape() internally calls onAnyEscape (stop-audio), so no extra send needed.
  ipcMain.on("yomi:escape", () => triggerEscape())

  // Toolbar button triggers — mirror the Ctrl+Space / Ctrl+Enter shortcuts.
  ipcMain.on("yomi:trigger-voice", () => triggerVoiceMode())
  ipcMain.on("yomi:trigger-text", () => triggerTextMode())
  ipcMain.on("yomi:stop-listening", () => triggerStopListening())

  // Returns the first screen source ID for system audio loopback capture in the renderer
  ipcMain.handle("yomi:get-desktop-source-id", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] })
    return sources[0]?.id ?? null
  })

  ipcMain.on("yomi:resize", (_e, w: number, h: number) => {
    resizeOverlay(w, h)
  })

  ipcMain.on("yomi:set-ignore-mouse-events", (_e, ignored: boolean) => {
    setOverlayMouseIgnored(ignored)
  })

  ipcMain.on(
    "yomi:set-hit-regions",
    (_e, regions: { x: number; y: number; width: number; height: number }[]) => {
      overlayHitRegions = regions.filter((r) => r.width > 0 && r.height > 0)
      updateOverlayMousePassthrough()
    },
  )

  let dragStart = { winX: 0, winY: 0, mouseX: 0, mouseY: 0 }
  ipcMain.on("yomi:drag-start", (_e, mouseX: number, mouseY: number) => {
    const b = overlayWin?.getBounds()
    dragStart = {
      winX: b?.x ?? overlayLogicalPos.x,
      winY: b?.y ?? overlayLogicalPos.y,
      mouseX,
      mouseY,
    }
  })
  ipcMain.on("yomi:drag-move", (_e, mouseX: number, mouseY: number) => {
    const dx = mouseX - dragStart.mouseX
    const dy = mouseY - dragStart.mouseY
    overlayLogicalPos = { x: dragStart.winX + dx, y: dragStart.winY + dy }
    overlayWin?.setPosition(overlayLogicalPos.x, overlayLogicalPos.y)
  })
  ipcMain.on("yomi:nudge", (_e, dx: number, dy: number) => {
    overlayLogicalPos = { x: overlayLogicalPos.x + dx, y: overlayLogicalPos.y + dy }
    overlayWin?.setPosition(overlayLogicalPos.x, overlayLogicalPos.y)
  })

  ipcMain.handle("yomi:copy-text", async (_e, text: string) => {
    clipboard.writeText(String(text ?? ""))
    return { ok: true }
  })

  // ── Auth IPC ────────────────────────────────────────────────────────────────

  ipcMain.handle("yomi:start-auth", async (_e, provider?: string) => {
    if (!overlayWin) return
    try {
      const token = await startDeviceCodeFlow(provider, (deviceUrl) => {
        openTrustedExternal(deviceUrl)
        overlayWin?.webContents.send("yomi:auth-waiting")
      })
      await completeSetup(token)
      overlayWin?.webContents.send("yomi:auth-ok")
    } catch (err) {
      overlayWin?.webContents.send(
        "yomi:auth-error",
        err instanceof Error ? err.message : "Sign-in failed",
      )
    }
  })

  ipcMain.on("yomi:sign-out", () => {
    clearToken()
    disableHotkeys()
    overlayWin?.webContents.send("yomi:auth-needed")
  })

  ipcMain.on("yomi:quit", () => app.quit())

  ipcMain.on("yomi:download-update", () => downloadUpdate())
  ipcMain.on("yomi:install-update", () => installUpdate())

  ipcMain.on("yomi:open-upgrade", () => {
    const base = process.env["YOMI_LANDING_URL"] ?? "https://yomi.arka6fx.com"
    openTrustedExternal(`${base}/pricing`)
  })

  ipcMain.on("yomi:open-dashboard", () => {
    const base = process.env["YOMI_LANDING_URL"] ?? "https://yomi.arka6fx.com"
    openTrustedExternal(`${base}/dashboard`)
  })

  ipcMain.on("yomi:open-integrations", () => {
    const base = process.env["YOMI_LANDING_URL"] ?? "https://yomi.arka6fx.com"
    openTrustedExternal(`${base}/dashboard`)
  })

  ipcMain.handle("yomi:pick-attachment", async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      properties: ["openFile"],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const b64 = (await readFile(filePath)).toString("base64")
    return { path: filePath, b64 }
  })

  // Handle 401 from subscription check — triggers re-auth
  ipcMain.handle("yomi:get-subscription-info", async () => {
    const token = loadToken()
    if (!token) return null
    try {
      const res = await fetch(`${BACKEND_URL}/api/billing/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearToken()
        disableHotkeys()
        overlayWin?.webContents.send("yomi:auth-needed")
        return null
      }
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  })

  ipcMain.handle("yomi:update-profile-name", async (_e, name: string) => {
    const token = loadToken()
    if (!token) throw new Error("Please sign in again")

    const res = await fetch(`${BACKEND_URL}/api/user/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      name?: string
      email?: string
      error?: string
    }

    if (res.status === 401) {
      clearToken()
      disableHotkeys()
      overlayWin?.webContents.send("yomi:auth-needed")
      throw new Error("Please sign in again")
    }
    if (!res.ok || !data.name || !data.email) {
      throw new Error(data.error ?? "Could not update profile")
    }

    overlayWin?.webContents.send("yomi:subscription-update", data)
    return { name: data.name, email: data.email }
  })

  // ── Integrations ────────────────────────────────────────────────────────────

  ipcMain.handle("yomi:get-integrations", async () => {
    const token = loadToken()
    if (!token) return []
    try {
      const res = await fetch(`${BACKEND_URL}/api/integrations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return []
      const data = (await res.json()) as { integrations: unknown[] }
      return data.integrations ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle("yomi:connect-integration", async (_e, id: string) => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    // Fetch the OAuth URL from backend (follows no redirect, captures Location header)
    try {
      const res = await fetch(`${BACKEND_URL}/api/integrations/connect/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "manual",
      })
      if (res.status === 302 || res.status === 301) {
        const location = res.headers.get("location")
        if (location) {
          await shell.openExternal(location)
          return { ok: true }
        }
      }
      if (res.ok) {
        // api_key or connection_string — return the config JSON for the renderer
        return res.json()
      }
      return { error: `Connect failed: ${res.status}` }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Connect failed" }
    }
  })

  ipcMain.handle("yomi:disconnect-integration", async (_e, provider: string) => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(`${BACKEND_URL}/api/integrations/${provider}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.ok ? { ok: true } : { error: `Delete failed: ${res.status}` }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Disconnect failed" }
    }
  })

  // ── RAG: Drive sources ──────────────────────────────────────────────────────

  ipcMain.handle("yomi:get-drive-sources", async () => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(`${BACKEND_URL}/api/rag/drive/sources`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { sources?: unknown[]; error?: string }
      if (!res.ok)
        return {
          error: data.error ?? `Failed: ${res.status}`,
          code: res.status === 403 ? "upgrade_required" : undefined,
        }
      return { sources: data.sources ?? [] }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load folders" }
    }
  })

  ipcMain.handle(
    "yomi:create-drive-source",
    async (_e, input: { folderId: string; name?: string }) => {
      const token = loadToken()
      if (!token) return { error: "Not signed in" }
      try {
        const res = await fetch(`${BACKEND_URL}/api/rag/drive/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
        })
        const data = (await res.json().catch(() => ({}))) as {
          id?: string
          error?: string
          code?: string
        }
        if (!res.ok) return { error: data.error ?? `Failed: ${res.status}`, code: data.code }
        return { id: data.id }
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to add folder" }
      }
    },
  )

  ipcMain.handle("yomi:delete-drive-source", async (_e, id: string) => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(`${BACKEND_URL}/api/rag/drive/sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) return { ok: true }
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      return { error: data.error ?? `Delete failed: ${res.status}`, code: data.code }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Delete failed" }
    }
  })

  // ── Suggested automations ───────────────────────────────────────────────────

  ipcMain.handle("yomi:get-suggestions", async () => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(`${BACKEND_URL}/api/suggestions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        suggestions?: unknown[]
        error?: string
        code?: string
      }
      if (!res.ok) return { error: data.error ?? `Failed: ${res.status}`, code: data.code }
      return { suggestions: data.suggestions ?? [] }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load suggestions" }
    }
  })

  ipcMain.handle("yomi:accept-suggestion", async (_e, dedupKey: string) => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/suggestions/${encodeURIComponent(dedupKey)}/accept`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as {
        scheduleId?: string
        error?: string
        code?: string
      }
      if (!res.ok) return { error: data.error ?? `Failed: ${res.status}`, code: data.code }
      return { scheduleId: data.scheduleId }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to enable suggestion" }
    }
  })

  ipcMain.handle("yomi:dismiss-suggestion", async (_e, dedupKey: string) => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/suggestions/${encodeURIComponent(dedupKey)}/dismiss`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok) return { error: data.error ?? `Failed: ${res.status}`, code: data.code }
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to dismiss suggestion" }
    }
  })

  // ── Bot channels (Telegram messaging gateway) ───────────────────────────────

  ipcMain.handle("yomi:gateway-connections", async () => {
    const token = loadToken()
    if (!token) return []
    try {
      const res = await fetch(`${BACKEND_URL}/api/gateway/connections`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return []
      const data = (await res.json()) as { platform: string; connectedAt: string }[]
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  })

  // Telegram one-click — returns a t.me deep link, opened in the browser
  ipcMain.handle("yomi:gateway-connect-telegram", async () => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(`${BACKEND_URL}/api/gateway/telegram/token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { deepLink?: string; error?: string }
      if (!res.ok || !data.deepLink) return { error: data.error ?? "Failed to connect" }
      await shell.openExternal(data.deepLink)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Connect failed" }
    }
  })

  ipcMain.handle("yomi:gateway-unlink", async (_e, platform: string) => {
    const token = loadToken()
    if (!token) return { error: "Not signed in" }
    try {
      const res = await fetch(`${BACKEND_URL}/api/gateway/connections/${platform}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.ok ? { ok: true } : { error: `Unlink failed: ${res.status}` }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Unlink failed" }
    }
  })

  // ── Local management (sessions, memory, schedules, diagnostics) ─────────────

  async function sidecarJson<T>(pathName: string, init?: RequestInit): Promise<T> {
    if (!sidecarInstance) throw new Error("Sidecar is not ready")
    const res = await fetch(`${sidecarInstance.baseUrl}${pathName}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-sidecar-secret": sidecarInstance.secret,
        ...(init?.headers ?? {}),
      },
    })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `Sidecar ${res.status}`)
    return data
  }

  ipcMain.handle("yomi:get-sessions", async (_e, query: string) => {
    try {
      const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""
      const data = await sidecarJson<{ sessions?: unknown[] }>(`/management/sessions${q}`)
      return data.sessions ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle("yomi:delete-session", async (_e, id: number) => {
    try {
      return await sidecarJson<{ ok?: boolean; deleted?: boolean }>(`/management/sessions/${id}`, {
        method: "DELETE",
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Delete failed" }
    }
  })

  ipcMain.handle("yomi:get-memories", async (_e, query: string) => {
    try {
      const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""
      const data = await sidecarJson<{ memories?: unknown[] }>(`/management/memories${q}`)
      return data.memories ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle(
    "yomi:add-memory",
    async (_e, input: { content: string; topic?: string; kind?: string; scope?: string }) => {
      try {
        return await sidecarJson<{ memory?: unknown }>("/management/memories", {
          method: "POST",
          body: JSON.stringify(input),
        })
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Memory add failed" }
      }
    },
  )

  ipcMain.handle("yomi:delete-memory", async (_e, id: string) => {
    try {
      return await sidecarJson<{ ok?: boolean }>(`/management/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Memory delete failed" }
    }
  })

  ipcMain.handle("yomi:get-schedules", async () => {
    try {
      const data = await sidecarJson<{ schedules?: unknown[] }>("/management/schedules")
      return data.schedules ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle(
    "yomi:save-schedule",
    async (
      _e,
      input: {
        id?: string
        schedule: string
        prompt: string
        deliverTo?: string[]
        enabled?: boolean
      },
    ) => {
      try {
        return await sidecarJson<{ schedule?: unknown }>("/management/schedules", {
          method: "POST",
          body: JSON.stringify(input),
        })
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Schedule save failed" }
      }
    },
  )

  ipcMain.handle("yomi:set-schedule-enabled", async (_e, id: string, enabled: boolean) => {
    try {
      return await sidecarJson<{ schedule?: unknown }>(
        `/management/schedules/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      )
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Schedule update failed" }
    }
  })

  ipcMain.handle("yomi:delete-schedule", async (_e, id: string) => {
    try {
      return await sidecarJson<{ ok?: boolean; deleted?: boolean }>(
        `/management/schedules/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      )
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Schedule delete failed" }
    }
  })

  ipcMain.handle("yomi:get-diagnostics", async () => {
    try {
      return await sidecarJson<{ diagnostics?: unknown; logs?: string[] }>(
        "/management/diagnostics",
      )
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Diagnostics unavailable" }
    }
  })

  setInterval(updateOverlayMousePassthrough, 50)

  // ── Load overlay ────────────────────────────────────────────────────────────

  if (process.env.ELECTRON_RENDERER_URL) {
    overlayWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    overlayWin.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  overlayWin.once("ready-to-show", async () => {
    overlayWin?.show()
    if (process.env.YOMI_DEV !== "true") initAutoUpdater(overlayWin!)
    // Check for a stored token in the background — renderer is already showing "checking" state
    const token = await checkStoredToken()
    if (token) {
      await completeSetup(token)
      overlayWin?.webContents.send("yomi:auth-ok")
    } else {
      overlayWin?.webContents.send("yomi:auth-needed")
    }
  })

  // ── Overlay keyboard shortcuts (no auth required) ───────────────────────────

  // Ctrl+Arrow — smooth overlay movement
  const NUDGE_DIRS: [string, number, number][] = [
    ["Ctrl+Left", -1, 0],
    ["Ctrl+Right", 1, 0],
    ["Ctrl+Up", 0, -1],
    ["Ctrl+Down", 0, 1],
  ]
  let nudgeDir = { x: 0, y: 0 }
  let nudgeVel = { x: 0, y: 0 }
  let nudgeTick: ReturnType<typeof setInterval> | null = null
  let nudgeStop: ReturnType<typeof setTimeout> | null = null
  const NUDGE_MAX = 24,
    NUDGE_ACCEL = 3

  const stopNudging = () => {
    if (nudgeTick) {
      clearInterval(nudgeTick)
      nudgeTick = null
    }
    if (nudgeStop) {
      clearTimeout(nudgeStop)
      nudgeStop = null
    }
    nudgeDir = { x: 0, y: 0 }
    nudgeVel = { x: 0, y: 0 }
  }

  for (const [combo, dx, dy] of NUDGE_DIRS) {
    globalShortcut.register(combo, () => {
      if (!overlayWin) return
      nudgeDir = { x: dx, y: dy }
      if (nudgeStop) clearTimeout(nudgeStop)
      nudgeStop = setTimeout(stopNudging, 150)
      if (!nudgeTick) {
        nudgeTick = setInterval(() => {
          if (!overlayWin) {
            stopNudging()
            return
          }
          nudgeVel.x =
            nudgeDir.x === 0
              ? 0
              : Math.min(Math.abs(nudgeVel.x) + NUDGE_ACCEL, NUDGE_MAX) * Math.sign(nudgeDir.x)
          nudgeVel.y =
            nudgeDir.y === 0
              ? 0
              : Math.min(Math.abs(nudgeVel.y) + NUDGE_ACCEL, NUDGE_MAX) * Math.sign(nudgeDir.y)
          overlayLogicalPos = {
            x: Math.round(overlayLogicalPos.x + nudgeVel.x),
            y: Math.round(overlayLogicalPos.y + nudgeVel.y),
          }
          overlayWin.setPosition(overlayLogicalPos.x, overlayLogicalPos.y)
        }, 16)
      }
    })
  }

  let visible = true
  globalShortcut.register("Ctrl+H", () => {
    if (!overlayWin) return
    visible = !visible
    if (visible) {
      overlayWin.show()
      resumeHotkeys()
    } else {
      overlayWin.hide()
      suspendHotkeys()
    }
  })

  globalShortcut.register("Ctrl+Q", () => app.quit())
})

// Session validation — periodically check the token is still valid.
// Catches cross-device sign-out (landing page → desktop re-auth).
function startSessionValidation() {
  setInterval(async () => {
    const token = loadToken()
    if (!token) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearToken()
        disableHotkeys()
        overlayWin?.webContents.send("yomi:auth-needed")
      }
    } catch {
      // Network error — ignore, retry next interval
    }
  }, 30_000)
}

// Duck/restore Spotify around a listening turn so a playing song doesn't drown out the user's
// voice in the mic. Fire-and-forget — never block the state transition on it.
function setSpotifyDuck(sidecar: SidecarManager, on: boolean): void {
  void fetch(`${sidecar.baseUrl}/spotify/duck`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
    body: JSON.stringify({ duck: on }),
  }).catch(() => {})
}

// Called after a valid token is obtained.
// First call: starts sidecar, registers IPC handlers, registers shortcuts.
// Subsequent calls (re-auth after sign-out): restarts sidecar with new token.
async function completeSetup(token: string) {
  if (!overlayWin) return

  if (!sidecarStarted) {
    sidecarStarted = true

    const sidecar = new SidecarManager(token)
    sidecarInstance = sidecar
    try {
      await sidecar.start()
    } catch (err) {
      if (process.env.YOMI_DEV === "true") {
        console.warn(
          "[yomi] sidecar not running — start it separately: cd apps/sidecar && bun run dev",
        )
      } else {
        console.error("[yomi] sidecar failed to start:", err)
      }
    }

    const { onListenStop, onTextQuery, onAbort, onAnalyze } = initSidecarIpc(sidecar, overlayWin)

    initHotkey({
      onStateChange: (s) => {
        if (s === "text-input") {
          // Ensure overlay is visible before focusing, then focus so the
          // input field can receive keyboard input immediately.
          overlayWin?.show()
          overlayWin?.focus()
        } else if (s === "listening") {
          // Show overlay so the user sees the recording indicator and ESC hint.
          overlayWin?.show()
        }
        // Duck Spotify while listening so a playing song doesn't drown out the user's voice;
        // restore it as soon as listening ends.
        setSpotifyDuck(sidecar, s === "listening")
        overlayWin?.webContents.send("yomi:state", s)
      },
      onListenStop,
      onTextQuery,
      onAbort,
      onAnalyze,
      // Fires on every ESC press regardless of state — stops TTS playback even
      // when the pipeline has already finished and state is back to idle.
      onAnyEscape: () => {
        overlayWin?.webContents.send("yomi:stop-audio")
      },
    })

    startSessionValidation()
  } else {
    // Re-auth after sign-out: restart sidecar with new token
    if (sidecarInstance) {
      await sidecarInstance.updateToken(token)
    }
    enableHotkeys()
  }
}

app.on("window-all-closed", () => {
  app.quit()
})

app.on("will-quit", () => globalShortcut.unregisterAll())
