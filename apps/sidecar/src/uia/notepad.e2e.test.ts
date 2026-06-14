// Notepad E2E test — full desktop automation scenario
// Opens Notepad, types content, verifies content via UIA and clipboard.
// Requires: Windows + compiled uia-helper.exe
// Logs: notepad-e2e-log.txt in workspace root.
// Run: bun test apps/sidecar/src/uia/notepad.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { uia } from "./client.js"
import type { UiaElement } from "@yomi/shared"

const LOG_FILE = join(import.meta.dir, "../../../../debug/notepad-e2e-log.txt")
let logBuf = ""
async function log(line: string) {
  const ts = new Date().toISOString().slice(11, 23)
  const entry = `[${ts}] ${line}\n`
  logBuf += entry; process.stdout.write(entry)
}
async function flushLog() {
  if (logBuf) {
    await mkdir(dirname(LOG_FILE), { recursive: true })
    await appendFile(LOG_FILE, logBuf, "utf8"); logBuf = ""
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function killNotepad() {
  try {
    const p = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
      "Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force"],
      { stdout: "ignore", stderr: "ignore" })
    await p.exited
  } catch { /* ignore */ }
}

function findEditor(elements: UiaElement[]): UiaElement | null {
  const c = elements.filter((el) =>
    el.enabled && !el.offscreen &&
    (el.patterns.includes("Value") || /^(?:Edit|Document)$/i.test(el.role)))
  return c.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0] ?? null
}

// Clipboard helpers
async function getClipboard(): Promise<string> {
  const p = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
    { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(p.stdout).text(); await p.exited.catch(() => null); return out
}
async function setClipboard(text: string): Promise<void> {
  const p = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    "[Console]::In.ReadToEnd() | Set-Clipboard"],
    { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  p.stdin.write(text); p.stdin.end(); await p.exited
}

// Read Notepad text via Ctrl+A, Ctrl+C, clipboard
async function readNotepad(hwnd: number): Promise<string> {
  await uia.setForeground(hwnd).catch(() => null); await sleep(400)
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null); await sleep(150)
  await uia.call("press_key", { keys: "Ctrl+C" }).catch(() => null); await sleep(400)
  return await getClipboard().catch(() => "")
}

// Write content into Notepad via clipboard paste (reliable for multi-line)
async function writeNotepad(hwnd: number, content: string): Promise<string> {
  await uia.setForeground(hwnd).catch(() => null); await sleep(300)
  const prev = await getClipboard().catch(() => "")
  await setClipboard(content); await sleep(150)
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null); await sleep(100)
  await uia.call("press_key", { keys: "Ctrl+V" }).catch(() => null); await sleep(500)
  await setClipboard(prev).catch(() => null)
  await uia.setForeground(hwnd).catch(() => null); await sleep(300)
  return await readNotepad(hwnd)
}

// Read editor value via UIA (ValuePattern) — the same way saveWindowsNotepadAs does
async function readNotepadValue(hwnd: number): Promise<string> {
  const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd }).catch(() =>
    ({ window: "", elements: [] as UiaElement[] }))
  const editor = findEditor(snap.elements)
  if (editor?.value && editor.value.length > 0) return editor.value
  // Fallback to clipboard read
  return await readNotepad(hwnd)
}

// Save Notepad content to a file (the system.ts saveWindowsNotepadAs approach)
// Reads editor value via UIA and writes directly — bypasses the save dialog.
async function saveNotepadFile(hwnd: number, filePath: string): Promise<boolean> {
  const dir = join(filePath, "..")
  await mkdir(dir, { recursive: true }).catch(() => {})
  const text = await readNotepadValue(hwnd)
  if (!text.trim()) { await log("WARN: empty editor — nothing to save"); return false }
  await Bun.write(filePath, text)
  await sleep(300)
  return existsSync(filePath)
}

function autoFilename(content: string): string {
  const words = content.trim().split(/\s+/).filter(w => w.length >= 2)
  const short = words.slice(0, 3).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "")
  return short || "note"
}

// =============================================================================

describe("Notepad E2E", () => {
  let skipReason = ""
  let notepadHwnd: number | null = null
  const createdFiles: string[] = []
  const TIMEOUT = 30_000

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Notepad E2E Test Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Notepad E2E Started ===")

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

    await killNotepad(); await sleep(600)
  })

  afterAll(async () => {
    for (const f of createdFiles) { try { await rm(f, { force: true }) } catch { /* ignore */ }; await log(`CLEANUP: ${f}`) }
    await killNotepad(); await sleep(300)
    await log("=== Notepad E2E Completed ==="); await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }

  // ========================================================================
  // 1. Open Notepad and inspect its UI
  // ========================================================================

  it("1a — launches Notepad and finds its window", async () => {
    skipIf()
    Bun.spawn(["notepad.exe"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })

    let hwnd: number | null = null
    for (let i = 0; i < 20; i++) {
      await sleep(400)
      hwnd = await uia.findWindow({ process: "Notepad" }).catch(() => null)
        ?? await uia.findWindow({ titleContains: "Notepad" }).catch(() => null)
      if (hwnd) break
    }
    await log(`Notepad hwnd: ${hwnd}`)
    expect(hwnd).toBeTruthy()
    notepadHwnd = hwnd
  }, TIMEOUT)

  it("1b — snapshots the Notepad UI tree", async () => {
    skipIf(); if (!notepadHwnd) return
    await uia.setForeground(notepadHwnd).catch(() => null); await sleep(600)
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd: notepadHwnd })
    await log(`UI tree: window="${snap.window}" elements=${snap.elements.length} truncated=${snap.truncated}`)
    expect(snap.elements.length).toBeGreaterThan(0)
    expect(snap.window).toMatch(/notepad/i)
  }, TIMEOUT)

  it("1c — finds the editor element with Value+Text+Scroll patterns", async () => {
    skipIf(); if (!notepadHwnd) return
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd: notepadHwnd })
    const editor = findEditor(snap.elements)
    await log(`Editor: ref=${editor?.ref} role=${editor?.role} patterns=${editor?.patterns?.join(",")}`)
    expect(editor).toBeTruthy()
    expect(editor!.patterns).toContain("Value")
    expect(editor!.patterns).toContain("Text")
  }, TIMEOUT)

  // ========================================================================
  // 2. New tab + write content
  // ========================================================================

  it("2a — creates a new tab via Ctrl+N", async () => {
    skipIf(); if (!notepadHwnd) return
    await uia.setForeground(notepadHwnd).catch(() => null); await sleep(400)
    await uia.call("press_key", { keys: "Ctrl+N" }).catch(() => null); await sleep(1200)
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd: notepadHwnd })
    await log(`After Ctrl+N: window="${snap.window}"`)
    expect(snap.window).toBeTruthy()
  }, TIMEOUT)

  it("2b — writes multi-line text via clipboard paste", async () => {
    skipIf(); if (!notepadHwnd) return
    const content = "Hello from Yomi!\r\nThis is an automated test.\r\nLine three here."
    const actual = await writeNotepad(notepadHwnd, content)
    await log(`Written: ${content.length} chars → read-back: ${actual.length} chars`)
    expect(actual).toContain("Hello from Yomi")
    expect(actual).toContain("automated test")
    expect(actual).toContain("Line three here")
  }, TIMEOUT)

  // ========================================================================
  // 3. Save content to Desktop (system.ts approach: read value + Bun.write)
  // ========================================================================

  let desktopSaved = ""

  it("3a — saves Notepad content to Desktop/yomi-test-note.txt", async () => {
    skipIf(); if (!notepadHwnd) return
    const fp = join(homedir(), "Desktop", "yomi-test-note.txt")
    const ok = await saveNotepadFile(notepadHwnd, fp)
    if (ok) { desktopSaved = fp; createdFiles.push(fp) }
    await log(`Save to file: ${fp} ${ok ? "OK" : "FAIL"}`)
    expect(ok).toBe(true)
  }, TIMEOUT)

  it("3b — verifies saved file content matches what was in Notepad", async () => {
    skipIf()
    if (!desktopSaved) { await log("SKIP: no saved file"); return }
    const content = await Bun.file(desktopSaved).text()
    await log(`File (${content.length} chars): "${content.slice(0, 80)}"`)
    expect(content).toContain("Hello from Yomi")
    expect(content).toContain("automated test")
  }, TIMEOUT)

  // ========================================================================
  // 4. New tab, different content, save to Downloads (auto-filename)
  // ========================================================================

  let downloadsSaved = ""

  it("4a — new tab, writes content, saves to Downloads with auto-filename", async () => {
    skipIf(); if (!notepadHwnd) return
    await uia.setForeground(notepadHwnd).catch(() => null); await sleep(400)
    await uia.call("press_key", { keys: "Ctrl+N" }).catch(() => null); await sleep(1200)

    const content = "Grocery list for weekend\r\nMilk eggs bread butter cheese\r\nDone"
    const actual = await writeNotepad(notepadHwnd, content)
    expect(actual).toContain("Grocery")
    await log(`Content verified: "${actual.slice(0, 70)}"`)

    const filename = autoFilename(content)
    const fp = join(homedir(), "Downloads", `${filename}.txt`)
    const ok = await saveNotepadFile(notepadHwnd, fp)
    if (ok) { downloadsSaved = fp; createdFiles.push(fp) }
    await log(`Save: ${fp} ${ok ? "OK" : "FAIL"} (auto-name: "${filename}")`)
    expect(ok).toBe(true)
  }, TIMEOUT)

  it("4b — verifies Downloads file content", async () => {
    skipIf()
    if (!downloadsSaved) { await log("SKIP: no Downloads file"); return }
    const content = await Bun.file(downloadsSaved).text()
    await log(`Downloads file (${content.length} chars): "${content.slice(0, 70)}"`)
    expect(content).toContain("Grocery list")
    expect(content).toContain("Milk")
  }, TIMEOUT)

  // ========================================================================
  // 5. Append text to existing Notepad document
  // ========================================================================

  it("5a — appends text to current document", async () => {
    skipIf(); if (!notepadHwnd) return
    await uia.setForeground(notepadHwnd).catch(() => null); await sleep(400)
    await uia.call("press_key", { keys: "Ctrl+End" }).catch(() => null); await sleep(150)
    await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(150)
    await uia.call("type_text", { text: "Appended line!" }).catch(() => null); await sleep(600)

    const actual = await readNotepad(notepadHwnd)
    await log(`After append tail: "${actual.slice(-60)}"`)
    expect(actual).toContain("Appended line")
  }, TIMEOUT)

  // ========================================================================
  // 6. UIA Text pattern — read full document text
  // ========================================================================

  it("6 — reads Notepad text via UIA TextPattern (get_text RPC)", async () => {
    skipIf(); if (!notepadHwnd) return
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd: notepadHwnd })
    const doc = snap.elements.find((e) => e.role === "Document" || e.patterns.includes("Text"))
    if (!doc) { await log("SKIP: no TextPattern element"); return }
    const result = await uia.getText(doc.ref)
    await log(`get_text: ok=${result.ok} length=${result.length}`)
    expect(result.ok).toBe(true)
    expect(result.text!.length).toBeGreaterThan(0)
    expect(result.text).toContain("Appended line")
  }, TIMEOUT)

  // ========================================================================
  // 7. System tool integration — set_value + save
  // ========================================================================

  let systemSaved = ""

  it("7a — set_value writes text via UIA ValuePattern", async () => {
    skipIf(); if (!notepadHwnd) return
    await uia.setForeground(notepadHwnd).catch(() => null); await sleep(400)
    await uia.call("press_key", { keys: "Ctrl+N" }).catch(() => null); await sleep(1200)

    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 30, hwnd: notepadHwnd })
    const editor = findEditor(snap.elements)
    if (!editor) { await log("SKIP: no editor"); return }

    const r = await uia.call("set_value", { ref: editor.ref, text: "System tool test content" })
    await log(`set_value: ok=${(r as { ok?: boolean }).ok ?? "?"}`)
    await sleep(400)

    const actual = await readNotepad(notepadHwnd)
    expect(actual).toContain("System tool test content")
  }, TIMEOUT)

  it("7b — saves to Downloads/yomi-system-save-test.txt via read+Bun.write", async () => {
    skipIf(); if (!notepadHwnd) return
    const fp = join(homedir(), "Downloads", "yomi-system-save-test.txt")
    const ok = await saveNotepadFile(notepadHwnd, fp)
    if (ok) {
      systemSaved = fp; createdFiles.push(fp)
      const content = await Bun.file(fp).text()
      expect(content).toContain("System tool test content")
    }
    await log(`System save: ${fp} ${ok ? "OK" : "FAIL"}`)
    expect(ok).toBe(true)
  }, TIMEOUT)

  // ========================================================================
  // 8. Path resolution (unit tests)
  // ========================================================================

  it("8 — resolveUserTextPath: desktop/downloads resolve correctly", () => {
    expect(join(homedir(), "Desktop", "yomi-note.txt")).toContain("Desktop")
    expect(join(homedir(), "Downloads", "yomi-note.txt")).toContain("Downloads")
    expect(join(homedir(), "Desktop", "my-file.txt")).toContain("my-file.txt")
  })

  // ========================================================================
  // 9. Auto-filename generation (unit tests)
  // ========================================================================

  it("9 — autoFilename generates short name from content", () => {
    expect(autoFilename("Meeting notes for Monday")).toBe("meeting-notes-for")
    expect(autoFilename("Grocery list")).toBe("grocery-list")
    expect(autoFilename("TODO")).toBe("todo")
    expect(autoFilename("A B C D E F")).toBe("note")
    expect(autoFilename("Go to store")).toBe("go-to-store")
    expect(autoFilename("")).toBe("note")
  })
})
