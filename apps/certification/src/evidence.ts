import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Evidence, EvidenceKind } from "./types.js"

const UIA_PATH = process.env.YOMI_UIA_HELPER
  || "C:\\Users\\arkag\\Projects\\yomi\\apps\\uia-helper\\bin\\Release\\net8.0-windows\\win-x64\\publish\\uia-helper.exe"

export class EvidenceCollector {
  private artifactDir: string
  private seq = 0

  constructor(artifactDir: string) {
    this.artifactDir = artifactDir
    mkdirSync(artifactDir, { recursive: true })
  }

  private nextSeq(): string {
    return String(++this.seq).padStart(3, "0")
  }

  screenshot(label: string): Promise<Evidence> {
    return this.captureEvidence("screenshot", label, async () => {
      const r = await this.uiaCall<{ image_b64?: string; width?: number; height?: number }>(
        "capture_screen", { format: "png" }, 15_000)
      if (r?.image_b64) {
        const buf = Buffer.from(r.image_b64, "base64")
        const fn = `screenshot-${this.nextSeq()}-${label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 50)}.png`
        const fp = join(this.artifactDir, fn)
        writeFileSync(fp, buf)
        return { passed: true, artifactPath: fp, detail: `${buf.length} bytes` }
      }
      return { passed: false, detail: "capture_screen returned no image" }
    })
  }

  windowScreenshot(hwnd: number | null | undefined, label: string): Promise<Evidence> {
    return this.captureEvidence("screenshot", label, async () => {
      if (!hwnd) return { passed: false, detail: "no window handle" }
      const r = await this.uiaCall<{ image_b64?: string }>(
        "window_screenshot", { hwnd }, 15_000)
      if (r?.image_b64) {
        const buf = Buffer.from(r.image_b64, "base64")
        const fn = `wscreenshot-${this.nextSeq()}-${label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 50)}.png`
        const fp = join(this.artifactDir, fn)
        writeFileSync(fp, buf)
        return { passed: true, artifactPath: fp, detail: `${buf.length} bytes` }
      }
      return { passed: false, detail: "window_screenshot returned no image" }
    })
  }

  uiTree(hwnd: number | null | undefined, label: string): Promise<Evidence> {
    return this.captureEvidence("ui_tree", label, async () => {
      if (!hwnd) return { passed: false, detail: "no window handle" }
      const snap = await this.uiaCall<{
        window?: string; elements: Array<Record<string, unknown>>; truncated?: boolean
      }>("get_ui_tree", { hwnd, maxNodes: 400, maxDepth: 30 }, 15_000)
      if (snap?.elements) {
        const fn = `ui-tree-${this.nextSeq()}-${label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 50)}.json`
        const fp = join(this.artifactDir, fn)
        writeFileSync(fp, JSON.stringify(snap, null, 2))
        return {
          passed: snap.elements.length > 0,
          artifactPath: fp,
          detail: `window="${snap.window}" elements=${snap.elements.length} truncated=${snap.truncated}`,
        }
      }
      return { passed: false, detail: "get_ui_tree failed" }
    })
  }

  clipboard(label: string): Promise<Evidence> {
    return this.captureEvidence("clipboard", label, async () => {
      const r = await this.uiaCall<{ ok: boolean; text?: string }>("get_clipboard", {}, 5_000)
      const text = r?.text ?? ""
      return {
        passed: r?.ok === true && text.length > 0,
        detail: `text="${text.slice(0, 200)}"`,
      }
    })
  }

  processState(processName: string, label: string): Promise<Evidence> {
    return this.captureEvidence("process_state", label, async () => {
      const r = await this.uiaCall<{
        processes?: Array<{ pid: number; name: string; title: string; hwnd: number }>
        count?: number
      }>("list_processes", { filter: processName }, 5_000)
      const count = r?.count ?? 0
      return {
        passed: count > 0,
        detail: `process="${processName}" instances=${count}`,
      }
    })
  }

  filesystem(filePath: string, label: string): Promise<Evidence> {
    const exists = existsSync(filePath)
    const detail = exists
      ? `file="${filePath}" exists=true`
      : `file="${filePath}" exists=false`
    return Promise.resolve({
      kind: "filesystem" as EvidenceKind,
      label,
      passed: exists,
      detail,
      artifactPath: exists ? filePath : undefined,
    })
  }

  custom(kind: EvidenceKind, label: string, passed: boolean, detail?: string): Evidence {
    return { kind, label, passed, detail }
  }

  private async captureEvidence(
    kind: EvidenceKind,
    label: string,
    capture: () => Promise<{ passed: boolean; artifactPath?: string; detail?: string }>,
  ): Promise<Evidence> {
    try {
      const result = await capture()
      return {
        kind,
        label,
        passed: result.passed,
        detail: result.detail,
        artifactPath: result.artifactPath,
      }
    } catch (e) {
      return {
        kind,
        label,
        passed: false,
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  }

  private async uiaCall<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5_000): Promise<T | null> {
    if (!existsSync(UIA_PATH)) {
      return null
    }
    try {
      const req = JSON.stringify({ id: Date.now(), method, params })
      const proc = Bun.spawn([UIA_PATH], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
      proc.stdin.write(req + "\n")
      proc.stdin.end()

      const timeout = setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, timeoutMs)
      const out = await new Response(proc.stdout).text()
      clearTimeout(timeout)
      await proc.exited.catch(() => null)

      const lines = out.trim().split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.result !== undefined) return parsed.result as T
          if (parsed.error) return null
        } catch { /* skip non-JSON */ }
      }
      return null
    } catch {
      return null
    }
  }
}
