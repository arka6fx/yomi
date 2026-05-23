import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { app } from "electron"
import type { ChildProcess } from "node:child_process"

// Resolve the compiled sidecar binary for the current platform/arch.
// In production the binary lives in <resources>/sidecar/ (extraResources in electron-builder.yml).
// In development it is expected at apps/sidecar/dist/ (built separately via `bun run build`).
function sidecarBinPath(): string {
  const ext = process.platform === "win32" ? ".exe" : ""
  const name = `sidecar-${process.platform}-${process.arch}${ext}`
  return app.isPackaged
    ? path.join(process.resourcesPath, "sidecar", name)
    : path.join(__dirname, "../../../sidecar/dist", name)
}

const HEALTH_INTERVAL_MS = 10_000
const HEALTH_FAIL_THRESHOLD = 3

export class SidecarManager {
  readonly secret = randomUUID()
  readonly baseUrl = "http://127.0.0.1:3002"
  private proc: ChildProcess | null = null
  private failCount = 0
  private sessionToken: string

  constructor(sessionToken: string) {
    this.sessionToken = sessionToken
  }

  async start(): Promise<void> {
    if (process.env.YOMI_DEV !== "true") {
      const bin = sidecarBinPath()
      this.proc = spawn(bin, [], {
        env: { ...process.env, SIDECAR_SECRET: this.secret, YOMI_SESSION_TOKEN: this.sessionToken },
        stdio: "inherit",
      })
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
    setInterval(async () => {
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
    await sleep(500)
    await this.start()
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
