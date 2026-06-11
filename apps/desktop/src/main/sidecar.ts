import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import type { ChildProcess } from "node:child_process"
import { BACKEND_URL } from "./auth"

function loadDotEnv(): void {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "../../../.env"),
    path.join(__dirname, "../../../../.env"),
  ]
  for (const file of candidates) {
    try {
      const content = readFileSync(file, "utf8")
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

// Resolve the compiled Windows sidecar binary.
// In production the binary lives in <resources>/sidecar/ (extraResources in electron-builder.yml).
// In development it is expected at apps/sidecar/dist/ (built separately via `bun run build`).
function sidecarBinPath(): string {
  const name = "sidecar-win32-x64.exe"
  return app.isPackaged
    ? path.join(process.resourcesPath, "sidecar", name)
    : path.join(__dirname, "../../../sidecar/dist", name)
}

// Resolve the UIA helper exe (Spec 16). Packaged: <resources>/uia/ (extraResources).
// Dev: apps/uia-helper/dist/ (built via `dotnet publish`). Passed to the sidecar as YOMI_UIA_HELPER.
function uiaHelperPath(): string {
  const name = "uia-helper.exe"
  return app.isPackaged
    ? path.join(process.resourcesPath, "uia", name)
    : path.join(__dirname, "../../../uia-helper/dist", name)
}

const HEALTH_INTERVAL_MS = 10_000
const HEALTH_FAIL_THRESHOLD = 3

export class SidecarManager {
  readonly secret = process.env.SIDECAR_SECRET || ""
  readonly baseUrl = "http://127.0.0.1:3002"
  private proc: ChildProcess | null = null
  private failCount = 0
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private sessionToken: string

  constructor(sessionToken: string) {
    this.sessionToken = sessionToken
  }

  async start(): Promise<void> {
    if (process.env.YOMI_DEV !== "true") {
      const bin = sidecarBinPath()
      this.proc = spawn(bin, [], {
        env: {
          ...process.env,
          SIDECAR_SECRET: this.secret,
          YOMI_SESSION_TOKEN: this.sessionToken,
          YOMI_BACKEND_URL: BACKEND_URL,
          YOMI_UIA_HELPER: uiaHelperPath(),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      this.proc.stdout?.on("data", (chunk) => console.warn(`[sidecar] ${String(chunk).trim()}`))
      this.proc.stderr?.on("data", (chunk) => console.error(`[sidecar] ${String(chunk).trim()}`))
      this.proc.on("error", (err) => console.error("[sidecar] spawn error", err))
    }
    await this.waitForHealth()
    this.startHealthLoop()
  }

  async waitForHealth(maxMs = 10_000): Promise<void> {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.baseUrl}/health`)
        if (res.ok) return
      } catch {
        /* not ready yet */
      }
      await sleep(200)
    }
    throw new Error("Sidecar failed to start within 10s")
  }

  private startHealthLoop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = setInterval(async () => {
      try {
        const res = await fetch(`${this.baseUrl}/health`)
        if (res.ok) {
          this.failCount = 0
          return
        }
        throw new Error("non-ok")
      } catch {
        if (++this.failCount >= HEALTH_FAIL_THRESHOLD) {
          console.error("[sidecar] 3 consecutive health failures — restarting")
          this.failCount = 0
          await this.restart()
        }
      }
    }, HEALTH_INTERVAL_MS)
  }

  async restart(): Promise<void> {
    this.proc?.kill()
    this.proc = null
    await sleep(500)
    await this.start()
  }

  async updateToken(newToken: string): Promise<void> {
    this.sessionToken = newToken
    await this.restart()
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
