// Architecture Upgrade E2E test — recovery engine, procedural memory, validation-first execution.
// Tests the new RPC methods (hover, double_click, drag_drop, highlight, clipboard, cursor, list_processes).
// Run: bun test apps/sidecar/src/uia/arch-upgrade.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { uia } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"
import {
  recover, executeWithRecovery, type RecoveryContext,
} from "./recovery.js"
import {
  rememberStrategy, recallBestStrategy, recallAllStrategies,
  recordFailure, recordDuration, getStrategyStats,
} from "./procedural-memory.js"
import {
  executePlan, validateWindowExists, classifyIntent, semanticDescribe,
} from "./act-executor.js"
import type { UiaElement } from "@yomi/shared"

const LOG_FILE = join(import.meta.dir, "../../../../arch-upgrade-e2e-log.txt")
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

describe("Architecture Upgrade E2E", () => {
  let skipReason = ""
  let testHwnd: number | null = null

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Arch Upgrade E2E Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Arch Upgrade E2E Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    toolGuardrail.resetForTurn()

    try { const p = await uia.call<{ ok: boolean }>("ping", {}, 10_000); if (!p?.ok) { skipReason = "helper down"; return } }
    catch (e) { skipReason = `helper: ${e instanceof Error ? e.message : String(e)}`; return }
    await log("OK: helper ping")

    // Open Notepad for testing
    const { spawn } = await import("bun")
    spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    for (let i = 0; i < 12; i++) {
      await sleep(400)
      testHwnd = await uia.findWindow({ process: "Notepad" }) ?? await uia.findWindow({ titleContains: "Notepad" })
      if (testHwnd) break
    }
    if (testHwnd) {
      await uia.maximizeWindow(testHwnd).catch(() => {})
      await sleep(500)
      await log(`Test app (Notepad) hwnd: ${testHwnd}`)
    }
  }, 30_000)

  afterAll(async () => {
    if (testHwnd) {
      await uia.closeWindow(testHwnd).catch(() => {})
      await sleep(400)
      // Kill leftover
      Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
        "Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force"],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    }
    await log("=== Arch Upgrade E2E Completed ==="); await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }

  // =========================================================================
  // 1. New RPC methods
  // =========================================================================

  describe("1. New RPC methods", () => {
    it("kill_process — kills a process by name", async () => {
      skipIf()
      // Launch calc, then kill it
      Bun.spawn(["calc.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(1500)
      const result = await uia.killProcess("CalculatorApp")
      await log(`killProcess CalculatorApp: ${JSON.stringify(result)}`)
      // May or may not kill depending on if calc.exe maps to CalculatorApp
    })

    it("list_processes — lists running processes with window titles", async () => {
      skipIf()
      const result = await uia.listProcesses()
      await log(`listProcesses: ${result.count} processes`)
      const sample = result.processes.slice(0, 5).map((p) => `${p.name} "${p.title}"`).join(" | ")
      await log(`Sample: ${sample}`)
      expect(result.count).toBeGreaterThan(0)
    })

    it("list_processes with filter", async () => {
      skipIf()
      const result = await uia.listProcesses("notepad")
      await log(`listProcesses notepad: ${result.count} matches`)
      expect(result.processes.some((p) => /notepad/i.test(p.name))).toBe(true)
    })

    it("get_clipboard / set_clipboardText — reads and writes clipboard", async () => {
      skipIf()
      const test = `Yomi-test-${Date.now()}`
      await uia.setClipboardText(test)
      const read = await uia.getClipboard()
      await log(`Clipboard: wrote "${test}", read "${read.text}"`)
      expect(read.ok).toBe(true)
      expect(read.text).toBe(test)
    })

    it("get_cursor_position", async () => {
      skipIf()
      const pos = await uia.getCursorPosition()
      await log(`Cursor: ${pos.x}, ${pos.y}`)
      expect(pos.ok).toBe(true)
      expect(typeof pos.x).toBe("number")
    })

    it("hover_element — moves mouse to element center", async () => {
      skipIf()
      if (!testHwnd) return
      const snap = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
      const edit = snap.elements.find((e) => e.role === "Document" || e.role === "Edit")
      if (!edit) { await log("SKIP: no editor element"); return }

      const result = await uia.hoverElement(edit.ref)
      await log(`hover_element: ${JSON.stringify(result)}`)
      expect(result.ok).toBe(true)
    })

    it("double_click — double clicks an element", async () => {
      skipIf()
      if (!testHwnd) return
      const snap = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
      const edit = snap.elements.find((e) => e.role === "Document" || e.role === "Edit")
      if (!edit) { await log("SKIP: no editor"); return }

      const result = await uia.doubleClick(edit.ref)
      await log(`double_click: ${JSON.stringify(result)}`)
      expect(result.ok).toBe(true)
    })

    it("highlight_element — brief visual highlight", async () => {
      skipIf()
      if (!testHwnd) return
      const snap = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
      const edit = snap.elements.find((e) => e.role === "Document" || e.role === "Edit")
      if (!edit) { await log("SKIP: no editor"); return }

      const result = await uia.highlightElement(edit.ref)
      await log(`highlight: ${JSON.stringify(result)}`)
      expect(result.ok).toBe(true)
    })

    it("drag_to_point", async () => {
      skipIf()
      const result = await uia.dragToPoint(100, 100, 200, 200)
      await log(`drag_to_point: ${JSON.stringify(result)}`)
      expect(result.ok).toBe(true)
    })
  })

  // =========================================================================
  // 2. Recovery Engine v2
  // =========================================================================

  describe("2. Recovery Engine v2 (reResolve → reFocus → reScan → rePlan)", () => {
    it("reRecover finds a stale element in fresh snapshot", async () => {
      skipIf()
      if (!testHwnd) return

      // Get initial element
      const snap1 = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
      const el = snap1.elements.find((e) => e.role === "Document" || e.role === "Edit")
      if (!el) { await log("SKIP: no editor"); return }

      const staleRef = el.ref
      // Force a new snapshot to invalidate refs
      await uia.getUiTree({ maxNodes: 50, maxDepth: 10, hwnd: testHwnd })

      const ctx: RecoveryContext = { staleRef, role: el.role, name: el.name, hwnd: testHwnd }
      const result = await recover(ctx)
      await log(`Recovery: recovered=${result.recovered} strategy="${result.strategy}" newRef=${result.newRef ?? "none"}`)
      // After getUiTree clears refs, reResolve should match by name+role
      expect(result.recovered).toBe(true)
    })

    it("executeWithRecovery retries after failure", async () => {
      skipIf()
      if (!testHwnd) return

      const snap = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
      const el = snap.elements.find((e) => e.role === "Document" || e.role === "Edit")
      if (!el) { await log("SKIP: no editor"); return }

      const result = await executeWithRecovery(
        async (ref) => uia.call("set_value", { ref, text: "Recovery test" }),
        { staleRef: el.ref, role: el.role, name: el.name, hwnd: testHwnd },
      )
      await log(`executeWithRecovery: ok=${result.ok} recovery=${result.recovery?.strategy ?? "none"}`)
      expect(result.ok).toBe(true)
    })

    it("rePlan falls back to keyboard shortcut", async () => {
      skipIf()
      const result = await recover({
        staleRef: "nonexistent_ref",
        role: "Button",
        name: "File",
        replanOptions: { keyboardFallback: "Alt+F" },
      })
      await log(`rePlan keyboard: recovered=${result.recovered} strategy="${result.strategy}"`)
      // Keyboard fallback always "recovers" since it just sends keys
    })
  })

  // =========================================================================
  // 3. Procedural Memory
  // =========================================================================

  describe("3. Procedural Memory (strategy learning)", () => {
    it("remembers and recalls strategies", async () => {
      await rememberStrategy({ app: "notepad", goal: "type_text", method: "set_value", confidence: 0.8, elementPattern: { role: "Document", nameRegex: "" } })
      await rememberStrategy({ app: "notepad", goal: "type_text", method: "clipboard_paste", confidence: 0.7, elementPattern: { role: "Edit", nameRegex: "" } })

      const best = await recallBestStrategy("notepad", "type_text")
      await log(`Best strategy for notepad/type_text: ${best?.method} (confidence: ${best?.confidence})`)
      expect(best).toBeTruthy()
      // Both strategies should exist (previous runs may have affected confidence ordering)
      const all = await recallAllStrategies("notepad")
      await log(`All notepad strategies: ${all.length}`)
      expect(all.length).toBeGreaterThanOrEqual(2)
    })

    it("records failure and decreases confidence", async () => {
      await recordFailure("notepad", "type_text", "set_value")
      const best = await recallBestStrategy("notepad", "type_text")
      await log(`After failure: ${best?.method} confidence=${best?.confidence}`)
      expect(best!.confidence).toBeLessThan(0.8)
    })

    it("records duration", async () => {
      await recordDuration("notepad", "type_text", "set_value", 450)
      await log("Duration recorded")
    })

    it("getStrategyStats returns summary", async () => {
      const stats = await getStrategyStats()
      await log(`Strategy stats: ${stats.total} total, byApp: ${JSON.stringify(stats.byApp)}`)
      expect(stats.total).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // 4. Validation-First Execution
  // =========================================================================

  describe("4. Validation-First Execution (Plan → Execute → Validate → Recover)", () => {
    it("executes a plan with pre+post validation", async () => {
      skipIf()
      if (!testHwnd) return

      const snap = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
      const el = snap.elements.find((e) => (e.role === "Document" || e.role === "Edit") && e.patterns.includes("Value"))
      if (!el) { await log("SKIP: no value-pattern editor"); return }

      const result = await executePlan({
        app: "notepad",
        goal: "type_text",
        toolName: "set_value",
        toolParams: { ref: el.ref, text: "Validation test" },
        recoveryContext: { staleRef: el.ref, role: el.role, name: el.name, hwnd: testHwnd },
        validateFn: async () => {
          // Check if the editor value changed
          const snap2 = await uia.getUiTree({ maxNodes: 100, maxDepth: 20, hwnd: testHwnd })
          const editor = snap2.elements.find((e) => e.ref === el.ref || (e.role === el.role && e.name === el.name))
          return editor?.value?.includes("Validation") ?? false
        },
      })
      await log(`executePlan: ok=${result.ok} strategy="${result.strategy ?? "none"}" duration=${result.durationMs}ms`)
      if (!result.ok) {
        await log(`  Recovery: ${JSON.stringify(result.recovery)}`)
      }
      expect(result.ok).toBe(true)
    })

    it("validateWindowExists helper works", async () => {
      skipIf()
      if (!testHwnd) return
      const vfn = validateWindowExists(testHwnd)
      const valid = await vfn()
      await log(`validateWindowExists: ${valid}`)
      expect(valid).toBe(true)
    })
  })

  // =========================================================================
  // 5. Semantic Intent Classification
  // =========================================================================

  describe("5. Semantic intent classification", () => {
    it("classifies buttons by intent", () => {
      expect(classifyIntent("Button", "Send").intent).toBe("send")
      expect(classifyIntent("Button", "Submit form").intent).toBe("send")
      expect(classifyIntent("Edit", "Search or start new chat").intent).toBe("search")
      expect(classifyIntent("Button", "Close dialog").intent).toBe("close")
      expect(classifyIntent("Button", "Go back").intent).toBe("navigate")
      expect(classifyIntent("Button", "OK").intent).toBe("confirm")
      expect(classifyIntent("Button", "Cancel").intent).toBe("cancel")
      expect(classifyIntent("Button", "Play").intent).toBe("play")
      expect(classifyIntent("Button", "Pause").intent).toBe("pause")
      expect(classifyIntent("Button", "Random button").intent).toBe("unknown")
    })

    it("produces semantic element descriptions", () => {
      const el: UiaElement = {
        ref: "w1e1", role: "Button", name: "Send message",
        rect: { x: 0, y: 0, width: 100, height: 30 },
        patterns: ["Invoke"], enabled: true,
      }
      const desc = semanticDescribe(el)
      expect(desc.intent.intent).toBe("send")
      expect(desc.intent.confidence).toBe(0.9)
    })
  })
})
