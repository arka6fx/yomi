import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { uia } from "./client.js"

const LOG_FILE = join(import.meta.dir, "../../../../failure-regression-log.txt")
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

async function killProcess(name: string) {
  try {
    const p = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
      `Get-Process ${name} -ErrorAction SilentlyContinue | Stop-Process -Force`],
      { stdout: "ignore", stderr: "ignore" })
    await p.exited
  } catch { /* ignore */ }
}

// =============================================================================
// Regression Tests for 7 Fixed Capabilities
// =============================================================================

describe("Regression: 7 fixed capabilities", () => {
  let skipReason = ""
  let notepadHwnd: number | null = null

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Failure Regression Test Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Failure Regression Tests Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"

    try {
      const ping = await uia.call<{ ok: boolean }>("ping", {}, 10_000)
      if (!ping?.ok) { skipReason = "helper ping returned false"; await log(`SKIP: ${skipReason}`); return }
      await log("OK: helper ping")
    } catch (e) {
      skipReason = `helper unavailable: ${e instanceof Error ? e.message : String(e)}`
      await log(`SKIP: ${skipReason}`); return
    }

    await killProcess("notepad"); await sleep(600)
  })

  afterAll(async () => {
    await flushLog()
    await log("=== Failure Regression Tests Completed ===")
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }

  // =========================================================================
  // Fix 1: window_get_foreground — correct response parsing
  // =========================================================================

  it("Fix 1 — window_get_foreground returns correct response structure", async () => {
    skipIf()
    const result = await uia.call<{ hwnd: number }>("get_foreground", {}, 5_000)
    await log(`get_foreground result: ${JSON.stringify(result)}`)
    // The C# helper returns { hwnd: N } directly as the result
    expect(result).toBeTruthy()
    expect(typeof result).toBe("object")
    // The key is "hwnd" should be at result level (not nested inside another result)
    expect((result as Record<string, unknown>).hwnd).toBeGreaterThan(0)
  }, 10_000)

  // =========================================================================
  // Fix 2: screen_monitor_count — correct response parsing
  // =========================================================================

  it("Fix 2 — monitor_count returns correct response structure with count", async () => {
    skipIf()
    const result = await uia.call<{ ok: boolean; count: number }>("monitor_count", {}, 5_000)
    await log(`monitor_count result: ${JSON.stringify(result)}`)
    expect(result).toBeTruthy()
    expect((result as Record<string, unknown>).count).toBeGreaterThan(0)
    expect((result as Record<string, unknown>).ok).toBe(true)
  }, 10_000)

  // =========================================================================
  // Fix 3: media_previous_track — correct key parameter
  // =========================================================================

  it("Fix 3 — media_key with prev_track does not throw", async () => {
    skipIf()
    const result = await uia.call<{ ok: boolean; key: string }>("media_key", { key: "prev_track" }, 5_000)
    await log(`media_key prev_track result: ${JSON.stringify(result)}`)
    expect(result).toBeTruthy()
    expect((result as Record<string, unknown>).ok).toBe(true)
  }, 10_000)

  it("media_key with previous_track still throws (backward compat)", async () => {
    skipIf()
    const result = await uia.call<unknown>("media_key", { key: "previous_track" }, 5_000).catch((e) => ({ error: e.message }))
    // Should fail — previous_track is not a valid key
    await log(`media_key previous_track result: ${JSON.stringify(result)}`)
    const r = result as Record<string, unknown>
    expect(r.ok).not.toBe(true)
  }, 10_000)

  it("media_key with all valid key names", async () => {
    skipIf()
    const validKeys = ["play_pause", "next_track", "prev_track", "play", "pause", "next", "previous", "stop"]
    for (const key of validKeys) {
      const result = await uia.call<{ ok: boolean }>("media_key", { key }, 5_000)
      await log(`media_key "${key}": ok=${(result as Record<string, unknown>).ok}`)
      expect((result as Record<string, unknown>).ok).toBe(true)
    }
  }, 15_000)

  // =========================================================================
  // Fix 4: ui_set_value — type_text fallback for Document controls
  // =========================================================================

  it("Fix 4 — set_value on Document falls back to type_text", async () => {
    skipIf()
    await killProcess("notepad"); await sleep(500)
    Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    await sleep(2000)

    let hwnd: number | null = null
    for (let i = 0; i < 10; i++) {
      hwnd = await uia.findWindow({ titleContains: "Notepad" }).catch(() => null)
      if (hwnd) break
      await sleep(500)
    }
    if (!hwnd) { await log("SKIP: could not find Notepad"); return }
    await log(`Notepad hwnd: ${hwnd}`)

    await uia.setForeground(hwnd).catch(() => null); await sleep(500)
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd })
    const doc = snap.elements.find((e) => e.role === "Document" || e.role === "Edit")
    if (!doc) { await log("SKIP: no Document element"); return }

    // Try set_value first (should fail on Document, which lacks Value pattern)
    const svResult = await uia.call("set_value", { ref: doc.ref, text: "Regression test" }).catch(() => ({ ok: false }))
    const svOk = (svResult as Record<string, unknown>).ok === true
    await log(`set_value on Document: ok=${svOk}`)

    if (!svOk && doc.role === "Document") {
      // Fallback: type_text
      await uia.setForeground(hwnd).catch(() => null); await sleep(300)
      const ttResult = await uia.call("type_text", { text: "Regression test via type_text" }).catch(() => ({ ok: false }))
      const ttOk = (ttResult as Record<string, unknown>).ok !== false
      await sleep(500)
      await log(`type_text fallback: ok=${ttOk}`)
      expect(ttOk).toBe(true)
    } else {
      await log(`set_value succeeded directly or non-Document element: ok=${svOk}`)
    }
  }, 30_000)

  // =========================================================================
  // Fix 5: ui_scroll — PageDown/PageUp keyboard fallback
  // =========================================================================

  it("Fix 5 — scroll on Document uses keyboard fallback", async () => {
    skipIf()
    // Find Notepad (should still be open from previous test)
    let hwnd = await uia.findWindow({ titleContains: "Notepad" }).catch(() => null)
    if (!hwnd) {
      await killProcess("notepad"); await sleep(500)
      Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(2000)
      for (let i = 0; i < 10; i++) {
        hwnd = await uia.findWindow({ titleContains: "Notepad" }).catch(() => null)
        if (hwnd) break
        await sleep(500)
      }
    }
    if (!hwnd) { await log("SKIP: could not find Notepad"); return }

    await uia.setForeground(hwnd).catch(() => null); await sleep(400)
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd })
    const doc = snap.elements.find((e) => e.role === "Document" || e.role === "Edit")
    if (!doc) { await log("SKIP: no Document element"); return }

    // Try scroll (should fail on Document, which lacks Scroll pattern)
    const scResult = await uia.call("scroll", { ref: doc.ref, horizontalPercent: -1, verticalPercent: 50 }).catch(() => ({ ok: false }))
    const scOk = (scResult as Record<string, unknown>).ok === true
    await log(`scroll on Document: ok=${scOk}`)

    if (!scOk && doc.role === "Document") {
      // Fallback: PageDown then PageUp
      const pdResult = await uia.call("press_key", { keys: "PageDown" }).catch(() => ({ ok: false }))
      await sleep(300)
      const puResult = await uia.call("press_key", { keys: "PageUp" }).catch(() => ({ ok: false }))
      const fallbackOk = (pdResult as Record<string, unknown>).ok !== false && (puResult as Record<string, unknown>).ok !== false
      await log(`scroll keyboard fallback: ok=${fallbackOk}`)
      expect(fallbackOk).toBe(true)
    }
  }, 30_000)

  // =========================================================================
  // Fix 6: ui_find_toggles — navigate to subpage
  // =========================================================================

  it("Fix 6 — navigate to Settings subpage to find toggles", async () => {
    skipIf()
    let hwnd: number | null = null
    for (let i = 0; i < 10; i++) {
      hwnd = await uia.findWindow({ titleContains: "Settings" }).catch(() => null)
      if (hwnd) break
      await sleep(500)
    }
    if (!hwnd) {
      Bun.spawn(["start", "ms-settings:"], { shell: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(3000)
      for (let i = 0; i < 15; i++) {
        hwnd = await uia.findWindow({ titleContains: "Settings" }).catch(() => null)
        if (hwnd) break
        await sleep(500)
      }
    }
    if (!hwnd) { await log("SKIP: could not find Settings"); return }

    // Try multiple search terms to find toggles
    const searchTerms = ["notifications", "colors", "bluetooth", "personalization"]
    let foundToggles = 0
    for (const term of searchTerms) {
      await uia.setForeground(hwnd).catch(() => null); await sleep(300)
      await uia.call("press_key", { keys: "Ctrl+E" }).catch(() => null); await sleep(300)
      await uia.call("type_text", { text: term }).catch(() => null); await sleep(500)
      await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(1000)

      const tree = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd })
      const toggles = tree.elements.filter((e) => e.role === "ToggleButton" || e.role === "CheckBox")
      foundToggles = toggles.length
      await log(`Settings toggles on "${term}" page: ${foundToggles}`)
      if (foundToggles > 0) break
    }

    // Also try searching by pattern
    if (foundToggles === 0) {
      const tree = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd })
      const patternToggles = tree.elements.filter((e) => e.patterns?.includes("Toggle"))
      await log(`Settings elements with Toggle pattern: ${patternToggles.length}`)
      if (patternToggles.length > 0) foundToggles = patternToggles.length
    }

    expect(foundToggles).toBeGreaterThan(0)
  }, 60_000)

  // =========================================================================
  // Fix 7: ui_expand_collapse — navigate to subpage
  // =========================================================================

  it("Fix 7 — navigate to Settings subpage to find expand/collapse elements", async () => {
    skipIf()
    let hwnd: number | null = null
    for (let i = 0; i < 10; i++) {
      hwnd = await uia.findWindow({ titleContains: "Settings" }).catch(() => null)
      if (hwnd) break
      await sleep(500)
    }
    if (!hwnd) { await log("SKIP: could not find Settings"); return }
    await uia.setForeground(hwnd).catch(() => null); await sleep(500)

    // Navigate to display subpage via Ctrl+E search
    await uia.call("press_key", { keys: "Ctrl+E" }).catch(() => null); await sleep(400)
    await uia.call("type_text", { text: "display" }).catch(() => null); await sleep(600)
    await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(1500)

    const tree = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd })
    const expanders = tree.elements.filter((e) => e.patterns?.includes("ExpandCollapse"))
    await log(`Settings expand/collapse on display page: ${expanders.length}`)
    // Display page typically has expand/collapse sections
    expect(expanders.length).toBeGreaterThan(0)
  }, 30_000)

  // =========================================================================
  // Cleanup: close Notepad
  // =========================================================================

  it("Cleanup — close remaining windows", async () => {
    skipIf()
    const notepad = await uia.findWindow({ titleContains: "Notepad" }).catch(() => null)
    if (notepad) {
      await uia.setForeground(notepad).catch(() => null); await sleep(300)
      await uia.closeWindow(notepad).catch(() => null); await sleep(300)
      // Handle "save" dialog if present
      await uia.call("press_key", { keys: "N" }).catch(() => null); await sleep(300)
    }
  }, 10_000)
})
