import { platform } from "os"
import path from "path"
import type { Subprocess } from "bun"
import type { UiaElement, UiaSnapshot } from "@yomi/shared"

// JSON-RPC client for the C# uia-helper (Spec 16). One process, line-delimited JSON over stdio.
// The helper is spawned lazily on first use and respawned if it dies.

const HELPER_TIMEOUT_MS = 5_000

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

// Prod: desktop passes the staged helper path via env. Dev: resolve next to the published dist.
function helperPath(): string {
  const fromEnv = process.env.YOMI_UIA_HELPER
  if (fromEnv) return fromEnv
  return path.resolve(import.meta.dir, "../../../uia-helper/dist/uia-helper.exe")
}

// Find the element in a fresh snapshot that best matches a now-stale one.
// Priority: automationId → exact name+role → fuzzy name (substring) + role.
export function matchElement(prev: UiaElement, elements: UiaElement[]): UiaElement | null {
  if (prev.automationId) {
    const m = elements.find((e) => e.automationId && e.automationId === prev.automationId)
    if (m) return m
  }
  if (prev.name) {
    const exact = elements.find((e) => e.role === prev.role && e.name === prev.name)
    if (exact) return exact
    const needle = prev.name.toLowerCase()
    const fuzzy = elements.find((e) => e.role === prev.role && e.name && e.name.toLowerCase().includes(needle))
    if (fuzzy) return fuzzy
  }
  return null
}

class UiaClient {
  private proc: Subprocess<"pipe", "pipe", "inherit"> | null = null
  private starting: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buf = ""
  // Title of the most recently snapshotted window — used by the safety blocklist.
  lastWindow = ""
  // Last snapshot's elements by ref — lets acting tools classify risk / label without a round-trip.
  private elementsByRef = new Map<string, UiaElement>()
  // Coordinate-fallback handoff: point_cursor stashes a target that click consumes.
  pendingPoint: { x: number; y: number } | null = null

  getElement(ref: string): UiaElement | undefined {
    return this.elementsByRef.get(ref)
  }

  // Re-snapshot the foreground window and find the element matching a now-stale ref, so a failed
  // action can retry against a fresh ref instead of bubbling "element no longer available" to the LLM.
  // Match priority: automationId → exact name+role → fuzzy name+role. Returns the new ref or null.
  async reResolve(ref: string): Promise<string | null> {
    const prev = this.elementsByRef.get(ref)
    if (!prev) return null
    const snap = await this.getUiTree()
    return matchElement(prev, snap.elements ?? [])?.ref ?? null
  }

  private async ensure(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) return
    if (!this.starting) {
      this.starting = this.spawn().finally(() => { this.starting = null })
    }
    return this.starting
  }

  private async spawn(): Promise<void> {
    if (platform() !== "win32") throw new Error("UIA automation is only available on Windows")
    const exe = helperPath()
    this.proc = Bun.spawn([exe], { stdin: "pipe", stdout: "pipe", stderr: "inherit" })
    void this.readLoop()
  }

  private async readLoop(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    const dec = new TextDecoder()
    try {
      for await (const chunk of proc.stdout) {
        this.buf += dec.decode(chunk, { stream: true })
        let nl: number
        while ((nl = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, nl).trim()
          this.buf = this.buf.slice(nl + 1)
          if (line) this.handleLine(line)
        }
      }
    } catch {
      /* stream closed */
    }
    // Helper exited: fail everything still in flight so callers don't hang.
    for (const p of this.pending.values()) p.reject(new Error("uia-helper exited"))
    this.pending.clear()
    this.proc = null
  }

  private handleLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } }
    try { msg = JSON.parse(line) } catch { return }
    if (typeof msg.id !== "number") return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message || "uia-helper error"))
    else p.resolve(msg.result)
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ensure()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`uia-helper timeout: ${method}`))
      }, HELPER_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try {
        this.proc!.stdin.write(JSON.stringify({ id, method, params }) + "\n")
        this.proc!.stdin.flush()
      } catch (e) {
        if (this.pending.delete(id)) { clearTimeout(timer); reject(e as Error) }
      }
    })
  }

  async getUiTree(params: { maxNodes?: number; maxDepth?: number; hwnd?: number } = {}): Promise<UiaSnapshot> {
    const snap = await this.call<UiaSnapshot>("get_ui_tree", params)
    this.lastWindow = snap.window ?? ""
    this.elementsByRef = new Map((snap.elements ?? []).map((e) => [e.ref, e]))
    return snap
  }

  async getWindowInfo(params: { hwnd?: number } = {}): Promise<{ window: string }> {
    const info = await this.call<{ window: string }>("get_window_info", params)
    this.lastWindow = info.window ?? ""
    return info
  }
}

export const uia = new UiaClient()
