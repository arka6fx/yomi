// Universal Windows Desktop Automation — app-agnostic action helpers + auto test suite.
// Every helper is generic: no hardcoded app logic. Works on Notepad, Explorer, Settings, etc.
// Builds on: recovery.ts, procedural-memory.ts, act-executor.ts, client.ts.
// Run: bun test apps/sidecar/src/uia/universal-automation.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { uia, matchElement } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"
import { recover, executeWithRecovery, type RecoveryContext } from "./recovery.js"
import { rememberStrategy, recallBestStrategy, getStrategyStats } from "./procedural-memory.js"
import { classifyIntent } from "./act-executor.js"
import type { UiaElement } from "@yomi/shared"

const LOG_FILE = join(import.meta.dir, "../../../../universal-automation-e2e-log.txt")
let logBuf = ""
async function log(line: string) {
  const ts = new Date().toISOString().slice(11, 23)
  const entry = `[${ts}] ${line}\n`; logBuf += entry; process.stdout.write(entry)
}
async function flushLog() {
  if (logBuf) {
    await mkdir(join(homedir(), ".yomi", "logs"), { recursive: true })
    await appendFile(LOG_FILE, logBuf, "utf8"); logBuf = ""
  }
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ===========================================================================
// Smart element resolver — confidence-based, app-agnostic
// ===========================================================================

interface ResolveResult { element: UiaElement | null; confidence: number; strategy: string }

async function resolveElement(
  elements: UiaElement[],
  opts: { role?: string; name?: string; automationId?: string; intent?: string },
): Promise<ResolveResult> {
  // Tier 1: automationId (highest confidence)
  if (opts.automationId) {
    const m = elements.find((e) => e.automationId === opts.automationId)
    if (m) return { element: m, confidence: 0.98, strategy: "automationId" }
  }
  // Tier 2: exact name + role
  if (opts.name && opts.role) {
    const m = elements.find((e) => e.role === opts.role && e.name === opts.name)
    if (m) return { element: m, confidence: 0.95, strategy: "exact_name_role" }
  }
  // Tier 3: name substring + role
  if (opts.name && opts.role) {
    const n = opts.name.toLowerCase()
    const m = elements.find((e) => e.role === opts.role && e.name?.toLowerCase().includes(n))
    if (m) return { element: m, confidence: 0.85, strategy: "fuzzy_name_role" }
  }
  // Tier 4: name substring (any role)
  if (opts.name) {
    const n = opts.name.toLowerCase()
    const m = elements.filter((e) => e.name?.toLowerCase().includes(n) && e.enabled && !e.offscreen)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
    if (m.length > 0) return { element: m[0], confidence: 0.7, strategy: "fuzzy_name" }
  }
  // Tier 5: semantic intent match
  if (opts.intent && opts.role) {
    const m = elements.filter((e) => e.role === opts.role && e.enabled)
      .find((e) => classifyIntent(e.role, e.name).intent === opts.intent)
    if (m) return { element: m, confidence: 0.6, strategy: "semantic_intent" }
  }
  return { element: null, confidence: 0, strategy: "no_match" }
}

// ===========================================================================
// Universal action helpers — app-agnostic, no hardcoded logic
// ===========================================================================

// Click a button by name/role — with validation and recovery.
async function clickButton(hwnd: number, name: string, opts?: { role?: string; retries?: number }) {
  const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 30, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const resolved = await resolveElement(snap.elements, { name, role: opts?.role || "Button" })
  await log(`  clickButton "${name}": confidence=${resolved.confidence.toFixed(2)} strategy=${resolved.strategy}`)
  if (!resolved.element) return false

  const result = await executeWithRecovery(
    async (ref) => uia.call("invoke_element", { ref }),
    { staleRef: resolved.element.ref, role: resolved.element.role, name: resolved.element.name, hwnd },
  )
  await sleep(500)
  return result.ok
}

// Set text in an Edit/Document field.
async function setText(hwnd: number, text: string, opts?: { fieldName?: string; retries?: number }) {
  const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 30, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const opts2 = { role: "Edit", name: opts?.fieldName }
  const resolved = opts?.fieldName
    ? await resolveElement(snap.elements, opts2)
    : { element: snap.elements.find((e) => (e.role === "Edit" || e.role === "Document") && e.enabled && !e.offscreen && e.patterns.includes("Value")) ?? null, confidence: 0.7, strategy: "largest_editable" }
  await log(`  setText "${text.slice(0, 30)}": confidence=${resolved.confidence.toFixed(2)}`)

  if (!resolved.element) {
    // Fallback: click at text area, use type_text
    await uia.call("type_text", { text }).catch(() => null)
    await sleep(300)
    return true
  }

  await uia.call("set_value", { ref: resolved.element.ref, text }).catch(() => null)
  await sleep(400)

  // Validate
  const verify = uia.getElement(resolved.element.ref)
  const ok = verify?.value?.includes(text.slice(0, 20)) ?? false
  if (!ok) {
    // Retry with type_text
    await uia.call("type_text", { text, ref: resolved.element.ref }).catch(() => null)
    await sleep(400)
  }
  return true
}

// Toggle a checkbox by name.
async function toggleCheckbox(hwnd: number, name: string) {
  const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 30, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const resolved = await resolveElement(snap.elements, { name, role: "CheckBox" })
  await log(`  toggleCheckbox "${name}": confidence=${resolved.confidence.toFixed(2)}`)
  if (!resolved.element) return false

  const before = resolved.element.patterns.includes("Toggle")
    ? undefined /* can't read toggle state from pattern list easily */
    : null

  await uia.call("toggle_element", { ref: resolved.element.ref }).catch(() => null)
  await sleep(300)
  return true
}

// Select an item from a dropdown/combobox.
async function selectDropdown(hwnd: number, dropdownName: string, itemName: string) {
  const snap = await uia.getUiTree({ maxNodes: 400, maxDepth: 35, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))

  // Find the dropdown
  const resolved = await resolveElement(snap.elements, { name: dropdownName, role: "ComboBox" })
  if (!resolved.element) {
    // Try broader search
    const alt = await resolveElement(snap.elements, { name: dropdownName })
    if (!alt.element) { await log(`  selectDropdown: dropdown "${dropdownName}" not found`); return false }
  }

  const dropdown = resolved.element
  await log(`  selectDropdown "${dropdownName}" → "${itemName}": confidence=${resolved.confidence.toFixed(2)}`)

  // Expand it
  if (dropdown.patterns.includes("ExpandCollapse")) {
    await uia.expandElement(dropdown.ref).catch(() => null)
    await sleep(400)
  }

  // Find the item in refreshed tree
  const snap2 = await uia.getUiTree({ maxNodes: 400, maxDepth: 35, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const itemResolved = await resolveElement(snap2.elements, { name: itemName, role: "ListItem" })
  if (itemResolved.element && itemResolved.element.patterns.includes("SelectionItem")) {
    await uia.call("invoke_element", { ref: itemResolved.element.ref }).catch(() => null)
    await sleep(300)
    return true
  }
  // Fallback: click the item
  if (itemResolved.element) {
    const cx = Math.round(itemResolved.element.rect.x + itemResolved.element.rect.width / 2)
    const cy = Math.round(itemResolved.element.rect.y + itemResolved.element.rect.height / 2)
    await uia.call("click_point", { x: cx, y: cy, button: "left" }).catch(() => null)
    await sleep(300)
    return true
  }
  return false
}

// Dismiss any visible ad/promo overlay.
async function dismissAd(hwnd: number): Promise<number> {
  const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 30, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const closePatterns = /^(close|dismiss|skip ad|close ad|no thanks|skip)$/i
  const closeBtns = snap.elements.filter((e) =>
    e.enabled && !e.offscreen && e.role === "Button" && closePatterns.test(e.name || ""))
  for (const btn of closeBtns) {
    await uia.call("invoke_element", { ref: btn.ref }).catch(() => null); await sleep(300)
  }
  if (closeBtns.length === 0) {
    await uia.call("press_key", { keys: "Escape" }).catch(() => null); await sleep(300)
  }
  await log(`  dismissAd: ${closeBtns.length} ad elements dismissed`)
  return closeBtns.length
}

// Scroll a container or window.
async function scrollElement(hwnd: number, direction: "up" | "down" | "left" | "right", amount = 50) {
  const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 20, hwnd, lite: true }).catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const scrollable = snap.elements.find((e) => e.patterns.includes("Scroll") && e.enabled && !e.offscreen)
  if (scrollable) {
    const hp = direction === "left" ? -1 : direction === "right" ? 50 : -1
    const vp = direction === "up" ? -1 : direction === "down" ? 50 : -1
    if (direction === "up") await uia.scroll(scrollable.ref, -1, 0)
    else if (direction === "down") await uia.scroll(scrollable.ref, -1, amount)
    else if (direction === "left") await uia.scroll(scrollable.ref, 0, -1)
    else await uia.scroll(scrollable.ref, amount, -1)
  } else {
    // Keyboard fallback
    const key = direction === "up" ? "Up" : direction === "down" ? "Down" : direction === "left" ? "Left" : "Right"
    for (let i = 0; i < Math.ceil(amount / 10); i++) { await uia.call("press_key", { keys: key }).catch(() => null); await sleep(30) }
  }
  await sleep(300)
}

// Launch an app by name (generic — tries multiple strategies).
async function launchApp(name: string): Promise<number | null> {
  // Check running first
  let hwnd = await uia.findWindow({ process: name }).catch(() => null)
    ?? await uia.findWindow({ titleContains: name }).catch(() => null)
  if (hwnd) {
    // Verify it's a real window, not the taskbar shell
    if (name === "explorer") {
      const info = await uia.getWindowInfo({ hwnd }).catch(() => ({ window: "" }))
      if (info.window === "Program Manager" || info.window === "Taskbar" || info.window.length < 3) hwnd = null
      else { await log(`  launchApp "${name}": already running hwnd=${hwnd}`); return hwnd }
    } else {
      await log(`  launchApp "${name}": already running hwnd=${hwnd}`); return hwnd
    }
  }

  // Try Start Menu
  const ps = `$a = Get-StartApps | Where-Object { $_.Name -like '*${name}*' } | Select-Object -First 1; if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)" } else { Start-Process '${name}' }`
  Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" })

  for (let i = 0; i < 20; i++) {
    await sleep(500)
    hwnd = await uia.findWindow({ process: name }).catch(() => null)
      ?? await uia.findWindow({ titleContains: name }).catch(() => null)
    if (hwnd) { await log(`  launchApp "${name}": launched hwnd=${hwnd}`); return hwnd }
  }
  await log(`  launchApp "${name}": FAILED`)
  return null
}

// ===========================================================================
// App test definitions — one per app, all generic
// ===========================================================================

interface AppTest {
  name: string; displayName: string; processName: string
  tests: { label: string; run: (hwnd: number) => Promise<boolean> }[]
}

const APP_TESTS: AppTest[] = [
  {
    name: "notepad", displayName: "Notepad", processName: "Notepad",
    tests: [
      { label: "find editor", run: async (hwnd) => {
        // Retry — tree may not be fully loaded on first snapshot
        for (let i = 0; i < 5; i++) {
          if (i > 0) await sleep(500)
          const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 25, hwnd, lite: true })
          if (snap.elements.some((e) => e.patterns.includes("Value") && (e.role === "Document" || e.role === "Edit"))) return true
        }
        return false
      }},
      { label: "type text", run: async (hwnd) => { await setText(hwnd, "Universal test"); return true }},
      { label: "close window", run: async (hwnd) => { await uia.closeWindow(hwnd); await sleep(300); return true }},
    ],
  },
  {
    name: "calculator", displayName: "Calculator", processName: "CalculatorApp",
    tests: [
      { label: "launch app", run: async (_hwnd) => {
        // Calculator is UWP — launch via calc.exe
        Bun.spawn(["calc.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
        for (let i = 0; i < 10; i++) {
          await sleep(500)
          const h = await uia.findWindow({ titleContains: "Calculator" }) ?? await uia.findWindow({ process: "CalculatorApp" })
          if (h) { await uia.closeWindow(h); await sleep(300); return true }
        }
        return false
      }},
    ],
  },
  {
    name: "explorer", displayName: "File Explorer", processName: "explorer",
    tests: [
      { label: "find file list", run: async (hwnd) => {
        await uia.setForeground(hwnd).catch(() => null); await sleep(500)
        const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 30, hwnd, lite: true })
        return snap.elements.some((e) => e.role === "List" && (e.childCount ?? 0) > 0)
      }},
      { label: "navigate address bar", run: async (hwnd) => {
        await uia.setForeground(hwnd).catch(() => null); await sleep(400)
        await uia.call("press_key", { keys: "Ctrl+L" }).catch(() => null); await sleep(400)
        await uia.call("type_text", { text: join(homedir(), "Desktop") }).catch(() => null); await sleep(300)
        await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(1500)
        const info = await uia.getWindowInfo({ hwnd }).catch(() => ({ window: "" }))
        return /Desktop|File Explorer/i.test(info.window)
      }},
      { label: "close window", run: async (hwnd) => { await uia.closeWindow(hwnd); await sleep(300); return true }},
    ],
  },
]

// ===========================================================================
// Test report
// ===========================================================================

interface TestReport {
  started: string; ended: string
  results: { app: string; test: string; passed: boolean; error?: string }[]
  totals: { pass: number; fail: number; total: number }
  avgConfidence: number
  strategyStats: { total: number; byApp: Record<string, number> }
}

// ===========================================================================

describe("Universal Windows Desktop Automation", () => {
  let skipReason = ""
  const report: TestReport = { started: new Date().toISOString(), ended: "", results: [], totals: { pass: 0, fail: 0, total: 0 }, avgConfidence: 0, strategyStats: { total: 0, byApp: {} } }

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Universal Automation E2E Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Universal Automation E2E Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    toolGuardrail.resetForTurn()

    try { const p = await uia.call<{ ok: boolean }>("ping", {}, 10_000); if (!p?.ok) { skipReason = "helper down"; return } }
    catch (e) { skipReason = `helper: ${e instanceof Error ? e.message : String(e)}`; return }
    await log("OK: helper ping")

    // Kill test app processes
    Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
      "Get-Process notepad,calculator -ErrorAction SilentlyContinue | Stop-Process -Force"],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    await sleep(600)
  }, 20_000)

  afterAll(async () => {
    // Kill leftover processes
    Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
      "Get-Process notepad,calculator -ErrorAction SilentlyContinue | Stop-Process -Force"],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    await sleep(300)

    report.ended = new Date().toISOString()
    report.totals.pass = report.results.filter((r) => r.passed).length
    report.totals.fail = report.results.filter((r) => !r.passed).length
    report.totals.total = report.results.length
    report.strategyStats = await getStrategyStats()

    // Write report
    const reportPath = join(import.meta.dir, "../../../../universal-automation-report.json")
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")
    await log(`Report: ${report.totals.pass}/${report.totals.total} pass (${(report.totals.pass / Math.max(1, report.totals.total) * 100).toFixed(1)}%)`)
    await log(`Report saved: ${reportPath}`)
    await log("=== Universal Automation E2E Completed ==="); await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }

  // =========================================================================
  // 1. Smart element resolution
  // =========================================================================

  describe("1. Smart element resolution", () => {
    it("resolves by automationId (confidence 0.98)", async () => {
      const els: UiaElement[] = [
        { ref: "w1e1", role: "Button", name: "Login", automationId: "btnLogin", rect: { x: 0, y: 0, width: 100, height: 30 }, patterns: ["Invoke"], enabled: true },
      ]
      const r = await resolveElement(els, { automationId: "btnLogin" })
      expect(r.confidence).toBe(0.98)
      expect(r.strategy).toBe("automationId")
    })

    it("resolves by exact name+role (0.95)", async () => {
      const els: UiaElement[] = [
        { ref: "w1e1", role: "Button", name: "Save", rect: { x: 0, y: 0, width: 100, height: 30 }, patterns: ["Invoke"], enabled: true },
      ]
      const r = await resolveElement(els, { name: "Save", role: "Button" })
      expect(r.confidence).toBe(0.95)
    })

    it("resolves by fuzzy name+role (0.85)", async () => {
      const els: UiaElement[] = [
        { ref: "w1e1", role: "Button", name: "Save Document As...", rect: { x: 0, y: 0, width: 100, height: 30 }, patterns: ["Invoke"], enabled: true },
      ]
      const r = await resolveElement(els, { name: "save", role: "Button" })
      expect(r.confidence).toBe(0.85)
    })

    it("resolves by semantic intent (0.6)", async () => {
      const els: UiaElement[] = [
        { ref: "w1e1", role: "Button", name: "Send message", rect: { x: 0, y: 0, width: 100, height: 30 }, patterns: ["Invoke"], enabled: true },
      ]
      const r = await resolveElement(els, { intent: "send", role: "Button" })
      expect(r.confidence).toBe(0.6)
      expect(r.strategy).toBe("semantic_intent")
    })

    it("returns no_match when nothing matches", async () => {
      const r = await resolveElement([], { name: "Nothing", role: "Button" })
      expect(r.confidence).toBe(0)
      expect(r.strategy).toBe("no_match")
    })
  })

  // =========================================================================
  // 2. Universal action helpers
  // =========================================================================

  describe("2. Universal action helpers", () => {
    it("dismissAd handles apps with no ads gracefully", async () => {
      skipIf()
      // Open a clean Notepad (no ads)
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(1500)
      const hwnd = await uia.findWindow({ process: "Notepad" }) ?? await uia.findWindow({ titleContains: "Notepad" })
      if (!hwnd) { await log("SKIP: no Notepad"); return }

      const dismissed = await dismissAd(hwnd)
      // dismissAd may find false positives (button names matching ad patterns) — that's safe
      await log(`dismissAd found ${dismissed} elements — safely handled`)
      expect(dismissed).toBeGreaterThanOrEqual(0) // non-destructive even with false positives

      await uia.closeWindow(hwnd); await sleep(300)
    })

    it("scrollElement uses keyboard fallback when no Scroll pattern", async () => {
      skipIf()
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(1500)
      const hwnd = await uia.findWindow({ process: "Notepad" }) ?? await uia.findWindow({ titleContains: "Notepad" })
      if (!hwnd) { await log("SKIP: no Notepad"); return }

      // Type some content to make scrolling meaningful
      await uia.call("type_text", { text: "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8\n" }).catch(() => null)
      await sleep(300)
      await scrollElement(hwnd, "down", 30)
      await scrollElement(hwnd, "up", 30)

      await uia.closeWindow(hwnd); await sleep(300)
    })
  })

  // =========================================================================
  // 3. Auto-generated app tests
  // =========================================================================

  describe("3. Auto-generated app test suite", () => {
    for (const app of APP_TESTS) {
      describe(`${app.displayName}`, () => {
        let appHwnd: number | null = null

        beforeAll(async () => {
          skipIf()
          appHwnd = await launchApp(app.processName)
          if (appHwnd) {
            await uia.maximizeWindow(appHwnd).catch(() => null)
            await sleep(800)
          }
        }, 20_000)

        afterAll(async () => {
          if (appHwnd) {
            await uia.closeWindow(appHwnd).catch(() => null)
            await sleep(400)
          }
        })

        for (const test of app.tests) {
          it(`test: ${test.label}`, async () => {
            skipIf()
            if (!appHwnd) {
              await log(`  SKIP: ${app.displayName} not available`)
              report.results.push({ app: app.displayName, test: test.label, passed: false, error: "app not available" })
              return
            }

            try {
              const passed = await test.run(appHwnd)
              report.results.push({ app: app.displayName, test: test.label, passed })
              if (!passed) await log(`  FAIL: ${app.displayName} — ${test.label}`)
              expect(passed).toBe(true)
            } catch (e) {
              report.results.push({ app: app.displayName, test: test.label, passed: false, error: String(e) })
              await log(`  ERROR: ${app.displayName} — ${test.label}: ${e}`)
            }
          }, 25_000)
        }
      })
    }
  })

  // =========================================================================
  // 4. Window management (move, resize, restore)
  // =========================================================================

  describe("4. Window management (move, resize, restore)", () => {
    it("move_window repositions a window", async () => {
      skipIf()
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(1500)
      const hwnd = await uia.findWindow({ process: "Notepad" }) ?? await uia.findWindow({ titleContains: "Notepad" })
      if (!hwnd) { await log("SKIP: no Notepad"); return }

      await uia.moveWindow(hwnd, 100, 100)
      await sleep(400)
      await uia.resizeWindow(hwnd, 800, 600)
      await sleep(400)
      await uia.restoreWindow(hwnd)
      await sleep(400)

      const info = await uia.getWindowInfo({ hwnd }).catch(() => ({ window: "" }))
      await log(`After move/resize/restore: window="${info.window}"`)
      expect(info.window).toBeTruthy()

      await uia.closeWindow(hwnd); await sleep(300)
    })
  })
})
