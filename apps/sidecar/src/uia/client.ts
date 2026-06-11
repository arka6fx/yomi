import { platform } from "os"
import path from "path"
import type { Subprocess } from "bun"
import type { FocusChangeEvent, TreeDiff, UiaElement, UiaSnapshot } from "@yomi/shared"

// JSON-RPC client for the C# uia-helper (Spec 16). One process, line-delimited JSON over stdio.
// The helper is spawned lazily on first use and respawned if it dies.

const DEBUG = () => !!process.env.DEBUG_UIA
const HELPER_TIMEOUT_MS = 5_000
// Enumerating a large accessibility tree (e.g. Spotify's WebView2, ~800 nodes) is slow over the
// cross-process COM bridge and routinely exceeds 5s — give get_ui_tree a much longer budget so a
// normal play doesn't trip a timeout cascade.
const TREE_TIMEOUT_MS = 15_000

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
    const fuzzy = elements.find(
      (e) => e.role === prev.role && e.name && e.name.toLowerCase().includes(needle),
    )
    if (fuzzy) return fuzzy
  }
  return null
}

// Diff two UiaElement arrays to find added, removed, and changed elements.
// Matching priority: automationId → exact name+role → fuzzy name+role (same as matchElement).
function computeDiff(oldElements: UiaElement[], newElements: UiaElement[]): TreeDiff {
  // Build match sets by identity criteria.
  type MatchKey = { automationId: string } | { name: string; role: string } | { name: string }
  function keyOf(e: UiaElement): MatchKey | null {
    if (e.automationId) return { automationId: e.automationId }
    if (e.name && e.role) return { name: e.name, role: e.role }
    return null
  }

  const newByKey = new Map<string, UiaElement>()
  for (const e of newElements) {
    const k = keyOf(e)
    if (k) newByKey.set(JSON.stringify(k), e)
  }

  const added: UiaElement[] = []
  const removed: UiaElement[] = []
  const changed: UiaElement[] = []

  for (const oldEl of oldElements) {
    const k = keyOf(oldEl)
    if (!k) continue
    const match = newByKey.get(JSON.stringify(k))
    if (!match) {
      removed.push(oldEl)
      if (DEBUG()) console.warn(`[uia/diff] removed: ${oldEl.role} "${oldEl.name}"`)
    } else {
      // Compare properties that change at runtime (enabled, value).
      if (
        oldEl.enabled !== match.enabled ||
        oldEl.value !== match.value
      ) {
        changed.push(match)
        if (DEBUG()) console.warn(`[uia/diff] changed: ${match.role} "${match.name}" enabled=${match.enabled} value=${match.value ?? ""}`)
      }
      // Consumed — remove so anything left in newByKey is truly new.
      newByKey.delete(JSON.stringify(k))
    }
  }

  for (const [_, e] of newByKey) {
    added.push(e)
    if (DEBUG()) console.warn(`[uia/diff] added: ${e.role} "${e.name}"`)
  }

  if (DEBUG()) console.warn(`[uia/diff] summary: +${added.length} -${removed.length} ~${changed.length}`)
  return { added, removed, changed }
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
  // Previous snapshot's elements for tree-diff computation.
  private previousElements: UiaElement[] | null = null
  // Focus-change event callback registered by the harness.
  onFocusChange: ((event: FocusChangeEvent) => void) | null = null
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
      this.starting = this.spawn().finally(() => {
        this.starting = null
      })
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
    let msg: { id?: number; result?: unknown; error?: { message?: string }; event?: string; hwnd?: number; window?: string }
    try {
      msg = JSON.parse(line)
    } catch {
      if (DEBUG()) console.warn(`[uia/client] non-JSON line from helper: "${line.slice(0, 80)}"`)
      return
    }
    // Event frames (no id, no pending request) — push to registered listeners.
    if (typeof msg.id !== "number") {
      if (msg.event === "focus_changed" && typeof msg.hwnd === "number") {
        if (DEBUG()) console.warn(`[uia/client] event frame: focus_changed hwnd=0x${msg.hwnd.toString(16)} window="${msg.window ?? ""}"`)
        if (this.onFocusChange) {
          this.onFocusChange({ hwnd: msg.hwnd, window: msg.window ?? "" })
        }
      } else {
        if (DEBUG()) console.warn(`[uia/client] unknown event frame: ${msg.event ?? "no event type"}`)
      }
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) {
      if (DEBUG()) console.warn(`[uia/client] RPC error id=${msg.id}: ${msg.error.message || "unknown"}`)
      p.reject(new Error(msg.error.message || "uia-helper error"))
    } else {
      if (DEBUG()) console.warn(`[uia/client] RPC response id=${msg.id} received`)
      p.resolve(msg.result)
    }
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = HELPER_TIMEOUT_MS,
  ): Promise<T> {
    await this.ensure()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`uia-helper timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      try {
        this.proc!.stdin.write(JSON.stringify({ id, method, params }) + "\n")
        this.proc!.stdin.flush()
      } catch (e) {
        if (this.pending.delete(id)) {
          clearTimeout(timer)
          reject(e as Error)
        }
      }
    })
  }

  async getUiTree(
    params: { maxNodes?: number; maxDepth?: number; hwnd?: number; lite?: boolean } = {},
  ): Promise<UiaSnapshot> {
    const isFirst = !this.previousElements
    if (DEBUG()) console.warn(`[uia/client] getUiTree() called hwnd=${params.hwnd ?? "foreground"} first=${isFirst}`)
    const snap = await this.call<UiaSnapshot>("get_ui_tree", params, TREE_TIMEOUT_MS)
    this.lastWindow = snap.window ?? ""
    const fresh = snap.elements ?? []
    if (DEBUG()) console.warn(`[uia/client] getUiTree() returned window="${snap.window}" elements=${fresh.length} truncated=${snap.truncated ?? false}`)
    // Compute diff against the previous snapshot when one exists.
    if (this.previousElements) {
      snap.diff = computeDiff(this.previousElements, fresh)
    } else {
      if (DEBUG()) console.warn(`[uia/client] getUiTree() first snapshot — no diff computed`)
    }
    this.previousElements = fresh
    this.elementsByRef = new Map(fresh.map((e) => [e.ref, e]))
    return snap
  }

  async getWindowInfo(params: { hwnd?: number } = {}): Promise<{ window: string }> {
    const info = await this.call<{ window: string }>("get_window_info", params)
    this.lastWindow = info.window ?? ""
    return info
  }

  // --- UIA action patterns (tree expansion, scroll, right-click, text, search) ---

  async expandElement(ref: string): Promise<{ ok: boolean; name?: string }> {
    return this.call<{ ok: boolean; name?: string }>("expand_element", { ref })
  }

  async collapseElement(ref: string): Promise<{ ok: boolean; name?: string }> {
    return this.call<{ ok: boolean; name?: string }>("collapse_element", { ref })
  }

  async scroll(
    ref: string,
    horizontalPercent?: number,
    verticalPercent?: number,
  ): Promise<{ ok: boolean; name?: string }> {
    return this.call<{ ok: boolean; name?: string }>("scroll", { ref, horizontalPercent, verticalPercent })
  }

  async rightClick(ref: string): Promise<{ ok: boolean; x?: number; y?: number }> {
    return this.call<{ ok: boolean; x?: number; y?: number }>("right_click", { ref })
  }

  async getSubtree(
    ref: string,
    maxNodes?: number,
    maxDepth?: number,
  ): Promise<{ elements: UiaElement[]; count: number }> {
    return this.call<{ elements: UiaElement[]; count: number }>("get_subtree", { ref, maxNodes, maxDepth })
  }

  async findElement(
    ref: string,
    role?: string,
    name?: string,
    automationId?: string,
  ): Promise<{ ok: boolean; element?: UiaElement; error?: string }> {
    return this.call<{ ok: boolean; element?: UiaElement; error?: string }>("find_element", {
      ref,
      role,
      name,
      automationId,
    })
  }

  async getText(ref: string): Promise<{ ok: boolean; text?: string; length?: number; name?: string }> {
    return this.call<{ ok: boolean; text?: string; length?: number; name?: string }>("get_text", { ref })
  }

  async getChildren(
    ref: string,
    maxChildren?: number,
  ): Promise<{ elements: UiaElement[]; count: number }> {
    return this.call<{ elements: UiaElement[]; count: number }>("get_children", { ref, maxChildren })
  }

  async getFocusTree(
    maxDepth?: number,
  ): Promise<{ ok: boolean; elements?: UiaElement[]; focusRef?: string; error?: string }> {
    return this.call<{ ok: boolean; elements?: UiaElement[]; focusRef?: string; error?: string }>(
      "get_focus_tree",
      { maxDepth },
    )
  }

  // --- Background primitives (Spec: background-mode automation) ---

  // Tap a media/volume hardware key — acts on the app owning the media session without focus.
  async mediaKey(key: string): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("media_key", { key })
  }

  // Per-app volume in the Windows mixer (Core Audio) — focus-free, invisible. Returns 0..1, or null
  // when the app has no active audio session (e.g. Spotify not playing).
  async getAppVolume(process: string): Promise<number | null> {
    const r = await this.call<{ volume?: number | null }>("get_app_volume", { process })
    return typeof r.volume === "number" ? r.volume : null
  }

  async setAppVolume(
    process: string,
    level: number,
  ): Promise<{ ok: boolean; before?: number | null }> {
    return this.call<{ ok: boolean; before?: number | null }>("set_app_volume", { process, level })
  }

  // Find an app window by process name / title substring without spawning PowerShell (which would
  // flash a console and steal foreground). Returns the hwnd, or null if no matching window.
  async findWindow(params: { process?: string; titleContains?: string }): Promise<number | null> {
    const r = await this.call<{ hwnd?: number }>("find_window", params)
    return typeof r.hwnd === "number" && r.hwnd > 0 ? r.hwnd : null
  }

  // The window the user is currently in — capture before a focus-shuttle to restore it after.
  async getForeground(): Promise<number | null> {
    const r = await this.call<{ hwnd?: number }>("get_foreground")
    return typeof r.hwnd === "number" && r.hwnd > 0 ? r.hwnd : null
  }

  // Restore focus to a previously captured window handle.
  async setForeground(hwnd: number): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("set_foreground", { hwnd })
  }

  // Maximize a window so its full UI renders.
  async maximizeWindow(hwnd: number): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("maximize_window", { hwnd })
  }
}

export const uia = new UiaClient()
