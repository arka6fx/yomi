import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { ChildProcess } from "node:child_process"

const HEALTH_INTERVAL_MS = 10_000
const HEALTH_FAIL_THRESHOLD = 3

export class SidecarManager {
  readonly secret = randomUUID()
  readonly baseUrl = "http://127.0.0.1:3002"
  private proc: ChildProcess | null = null
  private failCount = 0

  async start(): Promise<void> {
    if (process.env.YOMI_DEV !== "true") {
      // In production, SIDECAR_ENTRY should be set to the bundled sidecar path
      const entry = process.env.SIDECAR_ENTRY ?? "apps/sidecar/src/index.ts"
      this.proc = spawn("bun", ["run", entry], {
        env: { ...process.env, SIDECAR_SECRET: this.secret },
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
