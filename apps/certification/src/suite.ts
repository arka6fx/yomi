import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { EvidenceCollector } from "./evidence.js"
import type {
  AppCategory, CertificationStatus, Evidence, SuiteResult, TestDefinition, TestResult, TestVerdict,
} from "./types.js"

const UIA_PATH = process.env.YOMI_UIA_HELPER
  || "C:\\Users\\arkag\\Projects\\yomi\\apps\\uia-helper\\bin\\Release\\net8.0-windows\\win-x64\\publish\\uia-helper.exe"

export abstract class BaseSuite {
  protected app: string
  protected category: AppCategory
  protected tests: TestDefinition[] = []
  protected results: TestResult[] = []
  protected logBuf: string[] = []
  protected artifactDir: string
  protected evidence: EvidenceCollector
  protected autoconfirm: boolean
  protected skipIfUnavailable: boolean

  constructor(
    app: string,
    category: AppCategory,
    opts: {
      autoconfirm?: boolean
      skipIfUnavailable?: boolean
      artifactDir?: string
    } = {},
  ) {
    this.app = app
    this.category = category
    this.autoconfirm = opts.autoconfirm ?? !!process.env.YOMI_ACT_AUTOCONFIRM
    this.skipIfUnavailable = opts.skipIfUnavailable ?? true
    const baseDir = opts.artifactDir ?? join(process.cwd(), "audit", "certification", app)
    this.artifactDir = baseDir
    mkdirSync(this.artifactDir, { recursive: true })
    this.evidence = new EvidenceCollector(this.artifactDir)
    this.register()
  }

  abstract register(): void

  protected addTest(id: number, name: string, timeout: number, fn: () => Promise<Evidence[]>, executions?: number): void {
    this.tests.push({ id, name, timeout, fn, executions })
  }

  async run(): Promise<SuiteResult> {
    const startedAt = new Date().toISOString()
    this.log(`=== ${this.app} Certification Suite started ===`)

    if (!existsSync(UIA_PATH)) {
      this.log(`FATAL: uia-helper not found at ${UIA_PATH}`)
      this.results.push({
        id: 0, name: "UIA helper check", status: "error", duration: 0,
        evidence: [], startTime: new Date().toISOString(),
        error: `uia-helper not found at ${UIA_PATH}`,
      })
      return this.finalize(startedAt)
    }

    if (this.autoconfirm) {
      process.env.YOMI_ACT_AUTOCONFIRM = "true"
    }

    for (const test of this.tests) {
      await this.runTest(test)
    }

    await this.cleanup()
    return this.finalize(startedAt)
  }

  private async runTest(test: TestDefinition): Promise<void> {
    const startTime = new Date().toISOString()
    const start = Date.now()
    this.log(`\n--- TEST ${test.id}: ${test.name} ---`)

    try {
      const evidence = await Promise.race([
        test.fn(),
        new Promise<Evidence[]>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout after ${test.timeout}ms`)), test.timeout)),
      ])
      const duration = Date.now() - start
      const passed = evidence.every((e) => e.kind === "human_verification" || e.passed)
      const status: TestVerdict = passed ? "pass" : "fail"
      this.results.push({ id: test.id, name: test.name, status, duration, evidence, startTime, executions: test.executions })
      this.log(`${status.toUpperCase()} (${duration}ms): ${test.name}`)
    } catch (e) {
      const duration = Date.now() - start
      const msg = e instanceof Error ? e.message : String(e)
      const status: TestVerdict = msg.startsWith("SKIP:") ? "skip" : "fail"
      this.results.push({
        id: test.id, name: test.name, status, duration, evidence: [], startTime,
        error: msg,
      })
      this.log(`${status.toUpperCase()} (${duration}ms): ${test.name} — ${msg}`)
    }

    this.flushLog()
  }

  private finalize(startedAt: string): SuiteResult {
    const completedAt = new Date().toISOString()
    const duration = Date.now() - new Date(startedAt).getTime()
    const total = this.results.length
    const failed = this.results.filter((r) => r.status === "fail").length
    const skipped = this.results.filter((r) => r.status === "skip").length
    const errors = this.results.filter((r) => r.status === "error").length
    const execPassed = this.results
      .filter((r) => r.status === "pass")
      .reduce((s, r) => s + (r.executions ?? 1), 0)
    const execTotal = this.results.reduce((s, r) => s + (r.executions ?? 1), 0)
    const execTested = execTotal - skipped - errors
    const passed = this.results.filter((r) => r.status === "pass").length
    const successRate = execTested > 0 ? Math.round((execPassed / execTested) * 100) : 0
    const meetsThreshold = execTested >= 20 && successRate >= 95

    const status: CertificationStatus = errors === total
      ? "failing"
      : meetsThreshold
        ? "certified"
        : execTested > 0 && successRate >= 80
          ? "degraded"
          : execTested > 0
            ? "not_verified"
            : "pending"

    this.log(`\n=== ${this.app} Suite completed ===`)
    this.log(`Passed: ${passed}/${total} | Failed: ${failed} | Skipped: ${skipped} | Errors: ${errors}`)
    this.log(`Success rate: ${successRate}% | Threshold: ${execTested >= 20 ? "20 runs met" : `only ${execTested} runs`}`)
    this.log(`Status: ${status.toUpperCase()}`)
    this.flushLog()

    return {
      app: this.app,
      category: this.category,
      startedAt,
      completedAt,
      duration,
      tests: this.results,
      status,
      summary: { total, passed, failed, skipped, errors, successRate, meetsThreshold },
    }
  }

  protected async cleanup(): Promise<void> {
    // Override in subclasses for app-specific cleanup
  }

  // Logging
  protected log(line: string): void {
    const ts = new Date().toISOString().slice(11, 23)
    const entry = `[${ts}] [${this.app}] ${line}`
    this.logBuf.push(entry)
    process.stdout.write(entry + "\n")
  }

  protected flushLog(): void {
    if (this.logBuf.length === 0) return
    const logFile = join(this.artifactDir, "suite.log")
    mkdirSync(this.artifactDir, { recursive: true })
    appendFileSync(logFile, this.logBuf.join("\n") + "\n", "utf8")
    this.logBuf = []
  }

  // Evidence helpers
  protected async screenshot(label: string): Promise<Evidence> {
    return this.evidence.screenshot(`${this.app}-${label}`)
  }

  protected async windowScreenshot(hwnd: number | null, label: string): Promise<Evidence> {
    return this.evidence.windowScreenshot(hwnd, `${this.app}-${label}`)
  }

  protected async uiTree(hwnd: number | null, label: string): Promise<Evidence> {
    return this.evidence.uiTree(hwnd, `${this.app}-${label}`)
  }

  protected async clipboard(label: string): Promise<Evidence> {
    return this.evidence.clipboard(`${this.app}-${label}`)
  }

  protected async processState(processName: string, label: string): Promise<Evidence> {
    return this.evidence.processState(processName, `${this.app}-${label}`)
  }

  protected async filesystem(filePath: string, label: string): Promise<Evidence> {
    return this.evidence.filesystem(filePath, `${this.app}-${label}`)
  }

  protected customEvidence(kind: Evidence["kind"], label: string, passed: boolean, detail?: string): Evidence {
    return this.evidence.custom(kind, label, passed, detail)
  }

  // UIA helpers
  protected async uiaCall<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5_000): Promise<T | null> {
    if (!existsSync(UIA_PATH)) return null
    try {
      const req = JSON.stringify({ id: Date.now(), method, params })
      const proc = Bun.spawn([UIA_PATH], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
      proc.stdin.write(req + "\n")
      proc.stdin.end()

      const timeout = setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, timeoutMs)
      const out = await new Response(proc.stdout).text()
      clearTimeout(timeout)
      await proc.exited.catch(() => null)

      for (const line of out.trim().split("\n").filter(Boolean)) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.result !== undefined) return parsed.result as T
          if (parsed.error) return null
        } catch { /* skip */ }
      }
      return null
    } catch {
      return null
    }
  }

  protected async findWindow(params: { process?: string; titleContains?: string }): Promise<number | null> {
    const r = await this.uiaCall<{ hwnd?: number }>("find_window", params, 5_000)
    return typeof r?.hwnd === "number" && r.hwnd > 0 ? r.hwnd : null
  }

  protected async setForeground(hwnd: number): Promise<boolean> {
    const r = await this.uiaCall<{ ok: boolean }>("set_foreground", { hwnd }, 5_000)
    return r?.ok === true
  }

  protected async pressKey(keys: string): Promise<boolean> {
    const r = await this.uiaCall<{ ok: boolean }>("press_key", { keys }, 5_000)
    return r?.ok === true
  }

  protected async typeText(text: string): Promise<boolean> {
    const r = await this.uiaCall<{ ok: boolean }>("type_text", { text }, 5_000)
    return r?.ok === true
  }

  protected async invokeElement(ref: string): Promise<boolean> {
    const r = await this.uiaCall<{ ok?: boolean }>("invoke_element", { ref }, 5_000)
    return r?.ok === true
  }

  protected async setValue(ref: string, text: string): Promise<boolean> {
    const r = await this.uiaCall<{ ok?: boolean }>("set_value", { ref, text }, 5_000)
    return r?.ok === true
  }

  protected async mediaKey(key: string): Promise<boolean> {
    const r = await this.uiaCall<{ ok: boolean }>("media_key", { key }, 5_000)
    return r?.ok === true
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  protected async waitForWindow(
    params: { process?: string; titleContains?: string },
    timeoutMs = 10_000,
    intervalMs = 500,
  ): Promise<number | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hwnd = await this.findWindow(params)
      if (hwnd) return hwnd
      await this.sleep(intervalMs)
    }
    return null
  }

  protected async launchApp(command: string, args: string[] = []): Promise<void> {
    Bun.spawn([command, ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  }

  protected async launchPowerShell(script: string): Promise<void> {
    Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  }

  protected async killProcess(name: string): Promise<void> {
    try {
      await this.uiaCall("kill_process", { name }, 3_000)
    } catch { /* ignore */ }
  }

  protected async closeWindow(hwnd: number): Promise<boolean> {
    const r = await this.uiaCall<{ ok: boolean }>("close_window", { hwnd }, 3_000)
    return r?.ok === true
  }

  protected async getClipboardText(): Promise<string> {
    const r = await this.uiaCall<{ ok: boolean; text?: string }>("get_clipboard", {}, 3_000)
    return r?.text ?? ""
  }

  protected async setClipboardText(text: string): Promise<boolean> {
    const ps = Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command",
        "[Console]::In.ReadToEnd() | Set-Clipboard"],
      { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
    ps.stdin.write(text)
    ps.stdin.end()
    await ps.exited
    return true
  }

  // Smart click: try invoke_element, fallback to click_point, then reResolve
  protected async smartClick(
    hwnd: number,
    el: { ref: string; role?: string; name?: string; rect?: { x: number; y: number; width: number; height: number } },
    label: string,
  ): Promise<boolean> {
    this.log(`Click: ${el.role ?? "?"} "${el.name ?? "?"}" ref=${el.ref}`)
    let ok = false
    try {
      const r = await this.uiaCall<{ ok?: boolean }>("invoke_element", { ref: el.ref }, 5_000)
      ok = r?.ok === true
    } catch { /* stale ref */ }

    if (!ok && el.rect) {
      const cx = Math.round(el.rect.x + el.rect.width / 2)
      const cy = Math.round(el.rect.y + el.rect.height / 2)
      try {
        const r = await this.uiaCall<{ ok?: boolean }>("click_point", { x: cx, y: cy, button: "left" }, 5_000)
        ok = r?.ok === true
      } catch { /* ignore */ }
    }

    if (!ok) {
      try {
        const trees = await this.uiaCall<{ elements: Array<{ ref: string; name?: string }> }>(
          "get_ui_tree", { maxNodes: 300, maxDepth: 20 }, 10_000)
        if (trees?.elements) {
          const match = trees.elements.find((e) =>
            (el.name && e.name === el.name) || e.ref === el.ref)
          if (match) {
            const r = await this.uiaCall<{ ok?: boolean }>("invoke_element", { ref: match.ref }, 5_000)
            ok = r?.ok === true
          }
        }
      } catch { /* ignore */ }
    }

    await this.sleep(600)
    this.log(`Click ${label}: ${ok ? "OK" : "FAIL"}`)
    return ok
  }

  // Find elements in tree by criteria
  protected findInTree(
    elements: Array<{ role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect?: { x: number; y: number; width: number; height: number } }>,
    opts: {
      role?: string | string[]
      namePattern?: RegExp
      excludePattern?: RegExp
      enabled?: boolean
      notOffscreen?: boolean
      minWidth?: number
      minHeight?: number
    },
  ) {
    return elements.filter((el) => {
      if (opts.enabled !== undefined && el.enabled !== opts.enabled) return false
      if (opts.notOffscreen && el.offscreen) return false
      if (opts.role) {
        const roles = Array.isArray(opts.role) ? opts.role : [opts.role]
        if (!roles.includes(el.role)) return false
      }
      if (opts.namePattern && (!el.name || !opts.namePattern.test(el.name))) return false
      if (opts.excludePattern && el.name && opts.excludePattern.test(el.name)) return false
      if (opts.minWidth && (el.rect?.width ?? 0) < opts.minWidth) return false
      if (opts.minHeight && (el.rect?.height ?? 0) < opts.minHeight) return false
      return true
    })
  }
}
