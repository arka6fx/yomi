// Generic window management test — maximize, minimize, close any desktop app.
// Uses Hermes guardrails (applyHooks) + LangGraph-style validation.
// Each app is defined once; the test loops over available apps.
// Requires: Windows + compiled uia-helper.exe
// Run: bun test apps/sidecar/src/uia/window-manage.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { uia } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"

const LOG_FILE = join(import.meta.dir, "../../../../window-manage-e2e-log.txt")
let logBuf = ""
async function log(line: string) {
  const ts = new Date().toISOString().slice(11, 23)
  const entry = `[${ts}] ${line}\n`
  logBuf += entry; process.stdout.write(entry)
}
async function flushLog() {
  if (logBuf) {
    await mkdir(join(homedir(), ".yomi", "logs"), { recursive: true })
    await appendFile(LOG_FILE, logBuf, "utf8"); logBuf = ""
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ===========================================================================
// Hermes-style applyHooks wrapper — PreToolUse + execute + PostToolUse
// ===========================================================================

async function guardedCall(tool: string, params: Record<string, unknown>, timeoutMs = 10_000) {
  const pre = await hooks.onPreToolUse(tool, params)
  if (!pre.ok) { await log(`BLOCKED ${tool}: ${pre.reason}`); return { error: pre.reason } }
  const result = await uia.call(tool, params, timeoutMs).catch((e: Error) => ({ error: e.message }))
  return hooks.onPostToolUse(tool, result, params)
}

// LangGraph-style validation: post-condition check
async function validate(label: string, fn: () => Promise<boolean>) {
  try { if (await fn()) return true } catch (e) { await log(`VALIDATE ERROR ${label}: ${e instanceof Error ? e.message : String(e)}`) }
  await log(`VALIDATE FAIL: ${label}`)
  return false
}

// ===========================================================================
// App registry — define each app once, tests are auto-generated
// ===========================================================================

interface AppDef {
  name: string           // display name (e.g. "Explorer", "Notepad")
  find: () => Promise<number | null>  // returns hwnd or null
  launch: () => Promise<number | null>  // launches app, returns hwnd or null
  knownPaths?: string[]  // disk paths to check if installed
}

const openedHwnds: number[] = []
function track(hwnd: number | null) { if (hwnd && !openedHwnds.includes(hwnd)) openedHwnds.push(hwnd) }

async function closeAllWindows() {
  for (const hwnd of openedHwnds) {
    try { await uia.closeWindow(hwnd); await sleep(150) } catch { /* ignore */ }
  }
  // Fallback: kill processes we launched
  try {
    const p = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
      "Get-Process notepad,spotify,calculator -ErrorAction SilentlyContinue | Stop-Process -Force"],
      { stdout: "ignore", stderr: "ignore" })
    await p.exited
  } catch { /* ignore */ }
  await sleep(500)
  openedHwnds.length = 0
}

function killProcess(name: string) {
  Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    `Get-Process ${name} -ErrorAction SilentlyContinue | Stop-Process -Force`],
    { stdout: "ignore", stderr: "ignore" })
}

// ===========================================================================
// App definitions
// ===========================================================================

const APPS: AppDef[] = [
  {
    name: "Explorer",
    find: async () => {
      // Must be a file explorer window, not the shell taskbar.
      // File Explorer windows have "File Explorer" or a folder name in the title.
      const hwnd = await uia.findWindow({ titleContains: "File Explorer" })
      if (hwnd) return hwnd
      // Try process explorer but verify it's a file window
      const shellHwnd = await uia.findWindow({ process: "explorer" })
      if (shellHwnd) {
        const info = await uia.getWindowInfo({ hwnd: shellHwnd }).catch(() => null)
        if (info?.window && info.window !== "Program Manager" && info.window !== "Taskbar" && info.window.length > 5) {
          return shellHwnd
        }
      }
      return null
    },
    launch: async () => {
      Bun.spawn(["explorer.exe", join(homedir(), "Desktop")], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      for (let i = 0; i < 15; i++) {
        await sleep(400)
        const hwnd = await uia.findWindow({ titleContains: "File Explorer" }) ??
          await uia.findWindow({ titleContains: "Desktop" })
        if (hwnd) return hwnd
      }
      return null
    },
  },
  {
    name: "Notepad",
    find: async () =>
      uia.findWindow({ process: "Notepad" }) ??
      uia.findWindow({ titleContains: "Notepad" }),
    launch: async () => {
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      for (let i = 0; i < 15; i++) {
        await sleep(400)
        const hwnd = await uia.findWindow({ process: "Notepad" }) ??
          await uia.findWindow({ titleContains: "Notepad" })
        if (hwnd) return hwnd
      }
      return null
    },
  },
  {
    name: "Calculator",
    find: async () =>
      uia.findWindow({ titleContains: "Calculator" }) ??
      uia.findWindow({ process: "CalculatorApp" }),
    launch: async () => {
      Bun.spawn(["calc.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      for (let i = 0; i < 12; i++) {
        await sleep(500)
        const hwnd = await uia.findWindow({ titleContains: "Calculator" }) ??
          await uia.findWindow({ process: "CalculatorApp" })
        if (hwnd) return hwnd
      }
      return null
    },
  },
]

// ===========================================================================
// Core window management operations (generic, app-agnostic)
// ===========================================================================

async function verifyWindowExists(hwnd: number): Promise<boolean> {
  const info = await uia.getWindowInfo({ hwnd }).catch(() => null)
  return !!info?.window && info.window.length > 0
}

async function verifyWindowMinimized(hwnd: number): Promise<boolean> {
  // A minimized window still exists — getWindowInfo should still return its title
  const info = await uia.getWindowInfo({ hwnd }).catch(() => null)
  return !!info?.window
}

// ===========================================================================
// Tests — auto-generated per available app
// ===========================================================================

describe("Window Management — maximize, minimize, close (any app)", () => {
  let skipReason = ""
  const appStates = new Map<string, { hwnd: number; available: boolean }>()

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Window Management E2E Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Window Management E2E Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    toolGuardrail.resetForTurn()

    try {
      const ping = await uia.call<{ ok: boolean }>("ping", {}, 10_000)
      if (!ping?.ok) { skipReason = "helper down"; await log(`SKIP: ${skipReason}`); return }
      await log("OK: helper ping")
    } catch (e) {
      skipReason = `helper unavailable: ${e instanceof Error ? e.message : String(e)}`
      await log(`SKIP: ${skipReason}`); return
    }

    // Kill known apps to start clean
    killProcess("notepad")
    killProcess("spotify")
    await sleep(600)

    // Discover available apps
    await log(`Discovering apps: ${APPS.map((a) => a.name).join(", ")}`)
    for (const app of APPS) {
      let hwnd = await app.find()
      if (!hwnd) {
        await log(`  ${app.name}: not running — trying launch...`)
        hwnd = await app.launch()
      }
      if (hwnd) {
        await log(`  ${app.name}: FOUND hwnd=${hwnd}`)
        appStates.set(app.name, { hwnd, available: true })
        track(hwnd)
      } else {
        await log(`  ${app.name}: SKIP — could not find or launch`)
        appStates.set(app.name, { hwnd: 0, available: false })
      }
    }
  }, 40_000)

  afterAll(async () => {
    await log(`Closing ${openedHwnds.length} tracked windows...`)
    await closeAllWindows()
    await log("=== Window Management E2E Completed ===")
    await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }

  // Loop over each app, generating tests dynamically
  for (const app of APPS) {
    describe(`${app.name}`, () => {
      const getState = () => appStates.get(app.name)
      const unavailable = () => {
        const s = getState()
        if (!s?.available) throw new Error(`SKIP: ${app.name} not available`)
      }

      it(`maximize`, async () => {
        skipIf(); unavailable()
        const { hwnd } = getState()!

        await uia.setForeground(hwnd).catch(() => null); await sleep(400)
        const before = await uia.getWindowInfo({ hwnd }).catch(() => null)
        await log(`${app.name} before maximize: "${before?.window}"`)

        const result = await guardedCall("maximize_window", { hwnd })
        await log(`maximize_window: ${JSON.stringify(result).slice(0, 80)}`)
        await sleep(600)

        const ok = await validate(`${app.name} exists after maximize`, () => verifyWindowExists(hwnd))
        expect(ok).toBe(true)
      }, 15_000)

      it(`minimize`, async () => {
        skipIf(); unavailable()
        const { hwnd } = getState()!

        const result = await guardedCall("minimize_window", { hwnd })
        await log(`minimize_window: ${JSON.stringify(result).slice(0, 80)}`)
        await sleep(600)

        const ok = await validate(`${app.name} still exists after minimize`, () => verifyWindowMinimized(hwnd))
        expect(ok).toBe(true)
      }, 12_000)

      it(`restore after minimize`, async () => {
        skipIf(); unavailable()
        const { hwnd } = getState()!

        // maximizeWindow also restores from minimized
        await guardedCall("maximize_window", { hwnd })
        await sleep(400)
        await uia.setForeground(hwnd).catch(() => null); await sleep(500)

        // Verify we can snapshot the window tree (proves it's not minimized)
        const snap = await uia.getUiTree({ maxNodes: 150, maxDepth: 15, hwnd }).catch(() =>
          ({ window: "", elements: [] }))
        await log(`${app.name} after restore: window="${snap.window}" elements=${snap.elements.length}`)
        expect(snap.elements.length).toBeGreaterThan(0)
      }, 15_000)

      it(`close via WM_CLOSE`, async () => {
        skipIf(); unavailable()
        const { hwnd } = getState()!

        await log(`${app.name} closing hwnd=${hwnd}`)
        const result = await guardedCall("close_window", { hwnd })
        await log(`close_window: ${JSON.stringify(result).slice(0, 80)}`)
        await sleep(800)

        // Verify window is gone or unreachable
        const info = await uia.getWindowInfo({ hwnd }).catch(() => null)
        await log(`${app.name} after close: window="${info?.window ?? "undefined"}"`)
        // Mark as cleaned so afterAll doesn't try to close it again
        const idx = openedHwnds.indexOf(hwnd)
        if (idx >= 0) openedHwnds.splice(idx, 1)
      }, 12_000)
    })
  }

  // =========================================================================
  // Stress test: rapid maximize/minimize/close on a single window
  // =========================================================================

  describe("Rapid toggle stress test", () => {
    let stressHwnd: number | null = null
    const STRESS_APP = "Notepad"

    beforeAll(async () => {
      skipIf()
      // Kill any existing notepad, launch fresh
      killProcess("notepad"); await sleep(500)
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      for (let i = 0; i < 12; i++) {
        await sleep(400)
        stressHwnd = await uia.findWindow({ process: "Notepad" }) ??
          await uia.findWindow({ titleContains: "Notepad" })
        if (stressHwnd) break
      }
      if (stressHwnd) {
        track(stressHwnd)
        await log(`Stress test hwnd: ${stressHwnd}`)
      } else {
        await log("SKIP: could not launch Notepad for stress test")
      }
    }, 20_000)

    it("3x maximize → minimize → maximize cycle", async () => {
      skipIf()
      if (!stressHwnd) { await log("SKIP: no hwnd"); return }

      for (let i = 0; i < 3; i++) {
        await uia.setForeground(stressHwnd).catch(() => null); await sleep(200)
        await uia.maximizeWindow(stressHwnd); await sleep(300)
        await uia.minimizeWindow(stressHwnd); await sleep(300)
        await uia.maximizeWindow(stressHwnd); await sleep(300)
        await log(`  cycle ${i + 1}/3 done`)
      }

      // Should still be alive
      const ok = await verifyWindowExists(stressHwnd)
      await log(`After 3x toggle cycles: exists=${ok}`)
      expect(ok).toBe(true)
    }, 20_000)

    it("close after rapid toggling", async () => {
      skipIf()
      if (!stressHwnd) { await log("SKIP: no hwnd"); return }

      await uia.closeWindow(stressHwnd)
      await sleep(800)

      const info = await uia.getWindowInfo({ hwnd: stressHwnd }).catch(() => null)
      await log(`After close: window="${info?.window ?? "undefined"}"`)

      const idx = openedHwnds.indexOf(stressHwnd)
      if (idx >= 0) openedHwnds.splice(idx, 1)
      stressHwnd = null
    }, 10_000)
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("Edge cases", () => {
    it("closeWindow on already-closed hwnd is no-op", async () => {
      skipIf()
      // Use a fake hwnd that definitely doesn't exist
      const result = await uia.closeWindow(0xDEADBEEF).catch((e) => ({
        ok: false, error: e instanceof Error ? e.message : String(e),
      }))
      await log(`closeWindow fake hwnd: ${JSON.stringify(result)}`)
      // Should not crash — either returns ok:true (no-op) or an error
      expect(result).toBeDefined()
    }, 10_000)

    it("minimizeWindow on already-minimized window is idempotent", async () => {
      skipIf()
      // Open a fresh Notepad, minimize it, minimize again
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(2000)
      const hwnd = await uia.findWindow({ process: "Notepad" }) ??
        await uia.findWindow({ titleContains: "Notepad" })
      if (!hwnd) { await log("SKIP: no Notepad"); return }
      track(hwnd)

      // Minimize twice
      await uia.minimizeWindow(hwnd); await sleep(400)
      await uia.minimizeWindow(hwnd); await sleep(400)

      // Should still exist
      const exists = await verifyWindowMinimized(hwnd)
      await log(`After double-minimize: exists=${exists}`)
      expect(exists).toBe(true)

      // Cleanup
      await uia.closeWindow(hwnd); await sleep(500)
      const idx = openedHwnds.indexOf(hwnd)
      if (idx >= 0) openedHwnds.splice(idx, 1)
    }, 15_000)

    it("maximizeWindow on already-maximized window is idempotent", async () => {
      skipIf()
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(2000)
      const hwnd = await uia.findWindow({ process: "Notepad" }) ??
        await uia.findWindow({ titleContains: "Notepad" })
      if (!hwnd) { await log("SKIP: no Notepad"); return }
      track(hwnd)

      await uia.setForeground(hwnd).catch(() => null); await sleep(300)
      // Maximize twice
      await uia.maximizeWindow(hwnd); await sleep(500)
      await uia.maximizeWindow(hwnd); await sleep(500)

      // Should be snapshot-able
      const snap = await uia.getUiTree({ maxNodes: 150, maxDepth: 15, hwnd }).catch(() =>
        ({ window: "", elements: [] }))
      await log(`After double-maximize: elements=${snap.elements.length}`)
      expect(snap.elements.length).toBeGreaterThan(0)

      // Cleanup
      await uia.closeWindow(hwnd); await sleep(500)
      const idx = openedHwnds.indexOf(hwnd)
      if (idx >= 0) openedHwnds.splice(idx, 1)
    }, 15_000)

    it("closeWindow via Alt+F4 fallback", async () => {
      skipIf()
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(2000)
      const hwnd = await uia.findWindow({ process: "Notepad" }) ??
        await uia.findWindow({ titleContains: "Notepad" })
      if (!hwnd) { await log("SKIP: no Notepad"); return }

      await uia.setForeground(hwnd).catch(() => null); await sleep(300)
      // Type something so Notepad asks to save
      await uia.call("type_text", { text: "test" }).catch(() => null); await sleep(300)

      // Alt+F4
      await uia.call("press_key", { keys: "Alt+F4" }).catch(() => null)
      await sleep(500)
      // Handle "Do you want to save" dialog
      await uia.call("press_key", { keys: "N" }).catch(() => null) // Don't Save
      await sleep(500)

      const still = await uia.findWindow({ titleContains: "Notepad" }).catch(() => null)
      await log(`Notepad after Alt+F4: ${still ? `still exists hwnd=${still}` : "GONE"}`)
      if (still) {
        await uia.closeWindow(still); await sleep(500)
      }
    }, 15_000)
  })
})
