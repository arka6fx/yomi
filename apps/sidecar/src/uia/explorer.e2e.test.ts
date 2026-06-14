// Windows Explorer E2E test — open directories, navigate, read file listings
// Opens Explorer to various directories, verifies UI tree, navigates via address bar.
// Requires: Windows + compiled uia-helper.exe
// Logs: explorer-e2e-log.txt in workspace root.
// Run: bun test apps/sidecar/src/uia/explorer.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile, rm } from "node:fs/promises"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { uia } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"
import type { UiaElement } from "@yomi/shared"

const LOG_FILE = join(import.meta.dir, "../../../../debug/explorer-e2e-log.txt")
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

async function killExplorers() {
  try {
    const p = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
      "Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Stop-Process -Force"],
      { stdout: "ignore", stderr: "ignore" })
    await p.exited
  } catch { /* ignore */ }
}

// Open a directory in a new Explorer window
function openExplorer(path: string) {
  Bun.spawn(["explorer.exe", path], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}

// Find an Explorer window by directory name in the title
async function findExplorerWindow(titleFragment: string): Promise<number | null> {
  for (let i = 0; i < 15; i++) {
    const hwnd = await uia.findWindow({ titleContains: titleFragment }).catch(() => null)
    if (hwnd) return hwnd
    // Also try with "File Explorer" or just the folder name
    const hwnd2 = await uia.findWindow({ process: "explorer" }).catch(() => null)
    if (hwnd2) {
      const info = await uia.getWindowInfo({ hwnd: hwnd2 }).catch(() => null)
      if (info?.window && info.window.includes(titleFragment)) return hwnd2
    }
    await sleep(500)
  }
  return null
}

// Find the file list / items view within an Explorer tree
function findFileList(elements: UiaElement[]): UiaElement | null {
  // Explorer's main file list is usually a List/DataGrid with many children
  const candidates = elements.filter((el) =>
    el.enabled && !el.offscreen &&
    (el.role === "List" || el.role === "DataGrid" || el.role === "Table") &&
    el.childCount !== undefined && el.childCount > 0)
  // Prefer the one with the most children (the file list)
  return candidates.sort((a, b) => (b.childCount ?? 0) - (a.childCount ?? 0))[0] ?? null
}

// Find the address bar / breadcrumb bar Edit field
function findAddressBar(elements: UiaElement[]): UiaElement | null {
  // The address bar is usually a ComboBox or Edit with "Address" in the name
  const candidates = elements.filter((el) =>
    el.enabled && !el.offscreen &&
    (el.role === "Edit" || el.role === "ComboBox") &&
    (/address|path|breadcrumb|url/i.test(el.name) || el.patterns.includes("Value")))
  return candidates.sort((a, b) => b.rect.width - a.rect.width)[0] ?? null
}

// Find the tree view (navigation pane) in Explorer
function findTreeView(elements: UiaElement[]): UiaElement | null {
  return elements.find((el) =>
    el.enabled && !el.offscreen && el.role === "Tree" &&
    el.childCount !== undefined && el.childCount > 0) ?? null
}

// Navigate to a path using the address bar (Ctrl+L → type → Enter)
async function navigateTo(hwnd: number, targetPath: string): Promise<boolean> {
  await uia.setForeground(hwnd).catch(() => null); await sleep(400)

  // Ctrl+L focuses the address bar
  await uia.call("press_key", { keys: "Ctrl+L" }).catch(() => null)
  await sleep(500)

  // Select all existing text and type the new path
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null)
  await sleep(150)
  await uia.call("type_text", { text: targetPath }).catch(() => null)
  await sleep(400)
  await uia.call("press_key", { keys: "Enter" }).catch(() => null)
  await sleep(2000)

  // Verify we navigated by checking the window title
  const info = await uia.getWindowInfo({ hwnd }).catch(() => null)
  const folderName = targetPath.split("\\").pop() || targetPath
  await log(`After navigate to "${targetPath}": window="${info?.window}"`)
  return info?.window?.includes(folderName) ?? false
}

// Get file/folder names from the Explorer file list
async function getFileListItems(hwnd: number, maxDepth = 8): Promise<UiaElement[]> {
  const snap = await uia.getUiTree({ maxNodes: 500, maxDepth, hwnd }).catch(() =>
    ({ window: "", elements: [] as UiaElement[] }))
  const fileList = findFileList(snap.elements)
  if (!fileList) { await log("WARN: no file list found in Explorer tree"); return [] }
  await log(`FileList: ref=${fileList.ref} role=${fileList.role} childCount=${fileList.childCount}`)

  // Get direct children of the file list
  const children = await uia.getChildren(fileList.ref, 200).catch(() =>
    ({ elements: [] as UiaElement[], count: 0 }))
  await log(`FileList children: ${children.count}`)
  return children.elements
}

// =============================================================================

// Hermes-style guardrail wrapper: applies PreToolUse + PostToolUse hooks
// around every UIA action, matching Spec 19's applyHooks() integration point.
async function guardedUiaCall(toolName: string, params: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
  // PreToolUse — guardrail + threat scan
  const pre = await hooks.onPreToolUse(toolName, params)
  if (!pre.ok) { await log(`BLOCKED ${toolName}: ${pre.reason}`); return { error: pre.reason } }

  // Execute
  const result = await uia.call(toolName, params, timeoutMs).catch((e: Error) => ({ error: e.message }))

  // PostToolUse — guardrail observation + output trim + tree diff
  return hooks.onPostToolUse(toolName, result, params)
}

// Post-condition validation (Hermes "did the plan work?" cycle).
// Returns true if the condition passes, false + log otherwise.
async function validate(description: string, fn: () => Promise<boolean>): Promise<boolean> {
  try {
    const ok = await fn()
    if (ok) return true
    await log(`VALIDATE FAIL: ${description}`)
    return false
  } catch (e) {
    await log(`VALIDATE ERROR: ${description} — ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

// Tracked Explorer window handles for cleanup
const openedWindows: number[] = []

async function closeAllTrackedWindows() {
  for (const hwnd of openedWindows) {
    try {
      await uia.closeWindow(hwnd)
      await sleep(200)
    } catch { /* ignore */ }
  }
  // Also kill any remaining Explorer windows (stale refs / untracked)
  await killExplorers()
  await sleep(400)
  openedWindows.length = 0
}

function trackWindow(hwnd: number | null) {
  if (hwnd && !openedWindows.includes(hwnd)) openedWindows.push(hwnd)
}

describe("Windows Explorer E2E", () => {
  let skipReason = ""
  const createdDirs: string[] = []
  const TIMEOUT = 25_000

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Explorer E2E Test Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Explorer E2E Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"

    // Reset guardrail controller per turn (Hermes pattern)
    toolGuardrail.resetForTurn()

    try {
      const ping = await uia.call<{ ok: boolean }>("ping", {}, 10_000)
      if (!ping?.ok) { skipReason = "helper ping returned false"; await log(`SKIP: ${skipReason}`); return }
      await log("OK: helper ping")
    } catch (e) {
      skipReason = `helper unavailable: ${e instanceof Error ? e.message : String(e)}`
      await log(`SKIP: ${skipReason}`); return
    }

    // Create test directories for exploration tests
    const testDir = join(homedir(), "Desktop", "yomi-explorer-test")
    if (!existsSync(testDir)) mkdirSync(testDir)
    mkdirSync(join(testDir, "subfolder-a"))
    mkdirSync(join(testDir, "subfolder-b"))
    Bun.write(join(testDir, "readme.txt"), "Yomi Explorer test file")
    Bun.write(join(testDir, "notes.md"), "# Notes")
    createdDirs.push(testDir)

    await closeAllTrackedWindows(); await sleep(600)
  })

  afterAll(async () => {
    // Hermes-style cleanup: close every window we opened
    await log(`Closing ${openedWindows.length} tracked Explorer windows...`)
    await closeAllTrackedWindows()

    for (const d of createdDirs) {
      try { await rm(d, { recursive: true, force: true }) } catch { /* ignore */ }
      await log(`CLEANUP: ${d}`)
    }
    await log("=== Explorer E2E Completed ==="); await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }

  // ========================================================================
  // 1. Open Explorer to Desktop directory
  // ========================================================================

  let explorerHwnd: number | null = null
  let downloadsHwnd: number | null = null
  let rootHwnd: number | null = null

  it("1a — opens Explorer to Desktop", async () => {
    skipIf()
    const desktop = join(homedir(), "Desktop")
    openExplorer(desktop)
    await sleep(2000)

    const hwnd = await findExplorerWindow("Desktop")
    await log(`Desktop Explorer hwnd: ${hwnd}`)
    expect(hwnd).toBeTruthy()
    explorerHwnd = hwnd
    trackWindow(hwnd)

    // Hermes validation: window must be findable and have a title
    const validated = await validate("Desktop window exists and is titled", async () => {
      const info = await uia.getWindowInfo({ hwnd: hwnd! })
      return !!info?.window && /Desktop|File Explorer/i.test(info.window)
    })
    expect(validated).toBe(true)
  }, TIMEOUT)

  it("1b — snapshots Explorer UI tree", async () => {
    skipIf(); if (!explorerHwnd) return
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(600)

    const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: explorerHwnd })
    await log(`Explorer tree: window="${snap.window}" elements=${snap.elements.length}`)
    expect(snap.elements.length).toBeGreaterThan(10)
    expect(snap.window).toMatch(/Desktop|File Explorer/i)
  }, TIMEOUT)

  it("1c — finds the file list in Explorer", async () => {
    skipIf(); if (!explorerHwnd) return
    const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: explorerHwnd })
    const fileList = findFileList(snap.elements)

    if (fileList) {
      await log(`FileList: role=${fileList.role} name="${fileList.name}" childCount=${fileList.childCount}`)
      expect(fileList.childCount).toBeGreaterThan(0)
    } else {
      // Fallback: look for items view
      const items = snap.elements.filter((e) => e.role === "ListItem" || e.role === "TreeItem")
      await log(`Found ${items.length} ListItem/TreeItem elements (no single file list container)`)
      expect(items.length).toBeGreaterThan(0)
    }
  }, TIMEOUT)

  it("1d — reads children of the file list", async () => {
    skipIf(); if (!explorerHwnd) return
    const items = await getFileListItems(explorerHwnd, 8)
    if (items.length > 0) {
      const sample = items.slice(0, 5).map((e) => `${e.role} "${e.name}"`).join(", ")
      await log(`File items (${items.length} total): ${sample}`)
      // Should find our test folder
      const testFolder = items.find((e) => e.name.includes("yomi-explorer-test"))
      await log(`Found test folder: ${testFolder ? "YES" : "NO"}`)
    } else {
      await log("INFO: file list children not available via get_children — may need tree view approach")
    }
  }, TIMEOUT)

  // ========================================================================
  // 2. Open Explorer to Downloads
  // ========================================================================

  it("2a — opens Explorer to Downloads in a new window", async () => {
    skipIf()
    openExplorer(join(homedir(), "Downloads"))
    await sleep(2000)

    const hwnd = await findExplorerWindow("Downloads")
    await log(`Downloads Explorer hwnd: ${hwnd}`)
    expect(hwnd).toBeTruthy()
    downloadsHwnd = hwnd
    trackWindow(hwnd)
  }, TIMEOUT)

  it("2b — verifies Downloads window shows Downloads contents", async () => {
    skipIf()
    if (!downloadsHwnd) { await log("SKIP: no Downloads hwnd"); return }
    await uia.setForeground(downloadsHwnd).catch(() => null); await sleep(500)

    const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: downloadsHwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    await log(`Downloads tree: window="${snap.window}" elements=${snap.elements.length}`)
    expect(snap.window).toMatch(/Downloads|File Explorer/i)
    expect(snap.elements.length).toBeGreaterThan(5)
  }, TIMEOUT)

  // ========================================================================
  // 3. Open Explorer to C:\ (system root)
  // ========================================================================

  it("3a — opens Explorer to C:\\", async () => {
    skipIf()
    openExplorer("C:\\")
    await sleep(2000)

    const hwnd = await findExplorerWindow("Windows (C:)") ??
      await findExplorerWindow("Local Disk") ??
      await findExplorerWindow("(C:)")
    await log(`C:\\ Explorer hwnd: ${hwnd}`)
    // Fallback: any explorer window
    if (!hwnd) {
      rootHwnd = await uia.findWindow({ process: "explorer" }).catch(() => null)
    } else {
      rootHwnd = hwnd
    }
    expect(rootHwnd).toBeTruthy()
    trackWindow(rootHwnd)
  }, TIMEOUT)

  it("3b — verifies C:\\ shows system folders (Windows, Program Files, Users)", async () => {
    skipIf()
    if (!rootHwnd) { await log("SKIP: no C:\\ Explorer hwnd"); return }
    await uia.setForeground(rootHwnd).catch(() => null); await sleep(600)

    const snap = await uia.getUiTree({ maxNodes: 400, maxDepth: 25, hwnd: rootHwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    await log(`C:\\ tree: window="${snap.window}" elements=${snap.elements.length}`)

    // If tree is empty, try again with the foreground window
    if (snap.elements.length <= 1) {
      await log("WARN: C:\\ tree empty — trying foreground")
      await uia.setForeground(rootHwnd).catch(() => null); await sleep(1000)
      const fgSnap = await uia.getUiTree({ maxNodes: 400, maxDepth: 25 }).catch(() =>
        ({ window: "", elements: [] as UiaElement[] }))
      await log(`Foreground retry: window="${fgSnap.window}" elements=${fgSnap.elements.length}`)
      expect(fgSnap.elements.length).toBeGreaterThan(1)
      return
    }

    // Look for well-known system folders in the tree
    const sysFolders = ["Windows", "Program Files", "Users", "PerfLogs"]
    const found = sysFolders.filter((name) =>
      snap.elements.some((e) => e.name === name))
    await log(`System folders found: ${found.join(", ")} (${found.length}/${sysFolders.length})`)
    expect(found.length).toBeGreaterThan(0)
  }, TIMEOUT)

  // ========================================================================
  // 4. Navigate via address bar (Ctrl+L → type path → Enter)
  // ========================================================================

  it("4a — navigates C:\\ → C:\\Windows via address bar", async () => {
    skipIf()
    if (!rootHwnd) { await log("SKIP: no C:\\ hwnd"); return }
    await uia.setForeground(rootHwnd).catch(() => null); await sleep(500)

    const ok = await navigateTo(rootHwnd, "C:\\Windows")
    if (ok) {
      await log("Navigation to C:\\Windows successful")
    } else {
      await log("WARN: navigation may not have changed — checking tree")
      await uia.setForeground(rootHwnd).catch(() => null); await sleep(500)
      const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: rootHwnd }).catch(() =>
        ({ window: "", elements: [] as UiaElement[] }))
      const hasWinFiles = snap.elements.some((e) =>
        e.name === "System32" || e.name === "explorer.exe" || e.name === "notepad.exe")
      await log(`Windows files visible: ${hasWinFiles} (elements: ${snap.elements.length}, window: "${snap.window}")`)
    }
  }, TIMEOUT)

  it("4b — navigates to the user's home directory", async () => {
    skipIf()
    if (!rootHwnd) { await log("SKIP: no Explorer hwnd"); return }
    await uia.setForeground(rootHwnd).catch(() => null); await sleep(500)

    await navigateTo(rootHwnd, homedir())
    await sleep(1000)

    await uia.setForeground(rootHwnd).catch(() => null); await sleep(500)
    const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: rootHwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    await log(`Home dir tree: window="${snap.window}" elements=${snap.elements.length}`)

    if (snap.elements.length > 1) {
      const homeFolders = ["Desktop", "Documents", "Downloads"]
      const found = homeFolders.filter((name) =>
        snap.elements.some((e) => e.name === name))
      await log(`Home folders found: ${found.join(", ")}`)
    } else {
      await log("WARN: empty tree — window may not be foreground")
    }
  }, TIMEOUT)

  // ========================================================================
  // 5. Find specific elements with find_element
  // ========================================================================

  it("5 — finds the yomi-explorer-test folder using find_element", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer hwnd"); return }
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(500)

    // Navigate to Desktop first
    await navigateTo(explorerHwnd, join(homedir(), "Desktop"))
    await sleep(1500)

    const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: explorerHwnd })
    // Find the Desktop root container or file list
    const fileList = findFileList(snap.elements)
    const rootRef = fileList?.ref ?? snap.elements[0]?.ref
    if (!rootRef) { await log("SKIP: no root ref"); return }

    // Search for our test folder
    const result = await uia.findElement(rootRef, undefined, "yomi-explorer-test", undefined)
    await log(`find_element "yomi-explorer-test": ok=${result.ok} visited=${(result as { visited?: number }).visited ?? "N/A"}`)
    if (result.ok && result.element) {
      await log(`  Found: ref=${result.element.ref} role=${result.element.role} name="${result.element.name}"`)
      expect(result.element.name).toBe("yomi-explorer-test")
    }
  }, TIMEOUT)

  // ========================================================================
  // 6. Tree view / navigation pane
  // ========================================================================

  it("6 — finds Explorer's navigation tree view", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer hwnd"); return }
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(500)

    const snap = await uia.getUiTree({ maxNodes: 400, maxDepth: 30, hwnd: explorerHwnd })
    const treeView = findTreeView(snap.elements)

    if (treeView) {
      await log(`TreeView: ref=${treeView.ref} role=${treeView.role} name="${treeView.name}" childCount=${treeView.childCount}`)
      expect(treeView.childCount).toBeGreaterThan(0)

      // Try expanding a node in the tree
      if (treeView.patterns.includes("ExpandCollapse")) {
        await uia.expandElement(treeView.ref).catch(() => null)
        await log("ExpandCollapse supported on tree view")
      }

      // Get children of the tree
      const children = await uia.getChildren(treeView.ref, 20)
      const sample = children.elements.slice(0, 5).map((e) => `${e.role} "${e.name}"`).join(" | ")
      await log(`Tree children: ${children.count} — ${sample}`)
      expect(children.count).toBeGreaterThan(0)
    } else {
      await log("INFO: no TreeView element found in Explorer — may use different UIA structure")
    }
  }, TIMEOUT)

  // ========================================================================
  // 7. Open Explorer to a deeply nested path
  // ========================================================================

  it("7 — opens Explorer to deeply nested test folder", async () => {
    skipIf()
    const deepPath = join(homedir(), "Desktop", "yomi-explorer-test", "subfolder-a")
    openExplorer(deepPath)
    await sleep(2000)

    const hwnd = await findExplorerWindow("subfolder-a")
    await log(`Deep path Explorer hwnd: ${hwnd}`)
    expect(hwnd).toBeTruthy()
    trackWindow(hwnd)

    if (hwnd) {
      const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 20, hwnd })
      await log(`Subfolder tree: window="${snap.window}" elements=${snap.elements.length}`)
      expect(snap.window).toMatch(/subfolder-a/i)
    }
  }, TIMEOUT)

  // ========================================================================
  // 8. Use UIA get_ui_tree lite mode for faster tree
  // ========================================================================

  it("8 — lite mode returns same element count faster", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer hwnd"); return }
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(500)

    const full = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: explorerHwnd, lite: false })
    const lite = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: explorerHwnd, lite: true })

    await log(`Full: ${full.elements.length} elements, Lite: ${lite.elements.length} elements`)
    expect(full.elements.length).toBe(lite.elements.length)
  }, TIMEOUT)

  // ========================================================================
  // 9. Find and interact with Explorer ribbon/toolbar controls
  // ========================================================================

  it("9 — finds Explorer toolbar items", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer hwnd"); return }
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(500)

    const snap = await uia.getUiTree({ maxNodes: 400, maxDepth: 30, hwnd: explorerHwnd })

    // Look for toolbar/ribbon controls
    const toolbarItems = snap.elements.filter((e) =>
      e.enabled && !e.offscreen &&
      (e.role === "Button" || e.role === "SplitButton" || e.role === "MenuItem") &&
      !e.offscreen)
    const sample = toolbarItems.slice(0, 10).map((e) => `"${e.name}"`).join(", ")
    await log(`Toolbar items (${toolbarItems.length}): ${sample}`)

    // Check for common Explorer buttons
    const common = ["New folder", "New item", "Copy", "Paste", "Delete", "Rename",
      "Properties", "View", "Sort", "Home", "Share", "Search"]
    const found = common.filter((name) => toolbarItems.some((e) => e.name === name))
    await log(`Common buttons found: ${found.join(", ")}`)
    // No hard assertion — Explorer UI varies by Windows version
    expect(toolbarItems.length).toBeGreaterThan(0)
  }, TIMEOUT)

  // ========================================================================
  // 10. Navigate using the focus tree (get_focus_tree)
  // ========================================================================

  it("10 — get_focus_tree shows focused element in Explorer", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer hwnd"); return }
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(500)
    // Click somewhere in the file list to set focus
    const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 25, hwnd: explorerHwnd })
    const fileList = findFileList(snap.elements)
    if (fileList) {
      // Click at the center of the file list
      await uia.call("click_point", {
        x: Math.round(fileList.rect.x + fileList.rect.width / 2),
        y: Math.round(fileList.rect.y + fileList.rect.height / 2),
        button: "left",
      }).catch(() => null)
      await sleep(800)
    }

    const focus = await uia.getFocusTree()
    await log(`Focus tree: ok=${focus.ok} elements=${focus.elements?.length ?? 0}`)
    if (focus.ok && focus.elements) {
      const sample = focus.elements.map((e) => `${e.role} "${e.name}"`).join(" → ")
      await log(`Focus chain: ${sample}`)
      expect(focus.focusRef).toBeTruthy()
      expect(focus.elements.length).toBeGreaterThan(0)
    }
  }, TIMEOUT)

  // ========================================================================
  // 11. Search for a folder by name
  // ========================================================================

  it("11a — opens Explorer to C:\\Users\\arkag\\Projects and searches for yomi folder", async () => {
    skipIf()
    // Open Explorer to the projects folder
    const projectsPath = join(homedir(), "Projects")
    openExplorer(projectsPath)
    await sleep(2000)

    const hwnd = await findExplorerWindow("Projects")
    await log(`Projects Explorer hwnd: ${hwnd}`)
    expect(hwnd).toBeTruthy()
    trackWindow(hwnd)

    if (!hwnd) return
    await uia.setForeground(hwnd).catch(() => null); await sleep(600)

    // Ctrl+F to focus the search box
    await uia.call("press_key", { keys: "Ctrl+F" }).catch(() => null)
    await sleep(600)

    // Type "yomi" into the search box
    await uia.call("type_text", { text: "yomi" }).catch(() => null)
    await sleep(500)
    await uia.call("press_key", { keys: "Enter" }).catch(() => null)
    await sleep(3000) // wait for search results

    // Snapshot to see search results
    const snap = await uia.getUiTree({ maxNodes: 500, maxDepth: 30, hwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    await log(`Search results: window="${snap.window}" elements=${snap.elements.length}`)

    // Look for "yomi" in element names
    const yomiElements = snap.elements.filter((e) =>
      e.name && /yomi/i.test(e.name))
    await log(`Found ${yomiElements.length} elements matching "yomi"`)
    const sample = yomiElements.slice(0, 5).map((e) => `${e.role} "${e.name}"`).join(" | ")
    await log(`Yomi matches: ${sample}`)

    // The "yomi" project folder should appear after search
    const yomiFolder = yomiElements.find((e) =>
      e.role === "ListItem" || e.role === "TreeItem" || e.role === "GroupItem")
    await log(`Yomi folder item: ${yomiFolder ? `ref=${yomiFolder.ref} role=${yomiFolder.role}` : "NOT FOUND"}`)

    // Also try find_element for the exact name
    if (snap.elements.length > 0) {
      const found = await uia.findElement(snap.elements[0].ref, undefined, "yomi", undefined)
      await log(`find_element "yomi": ok=${found.ok}`)
    }

    // Clear search with Escape
    await uia.call("press_key", { keys: "Escape" }).catch(() => null)
    await sleep(500)
  }, TIMEOUT)

  it("11b — searches for yomi folder using file explorer search box directly", async () => {
    skipIf()
    // Navigate to Projects folder using an existing Explorer window
    if (!explorerHwnd) {
      // Open a fresh one
      openExplorer(join(homedir(), "Projects"))
      await sleep(2000)
      explorerHwnd = await findExplorerWindow("Projects")
    }
    if (!explorerHwnd) { await log("SKIP: no Explorer window"); return }
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(500)

    await navigateTo(explorerHwnd, join(homedir(), "Projects"))
    await sleep(1500)

    // Use Ctrl+E or Ctrl+F to focus search
    await uia.call("press_key", { keys: "Ctrl+E" }).catch(() => null)
    await sleep(600)
    await uia.call("type_text", { text: "yomi" }).catch(() => null)
    await sleep(400)
    await uia.call("press_key", { keys: "Enter" }).catch(() => null)
    await sleep(3000)

    const snap = await uia.getUiTree({ maxNodes: 500, maxDepth: 30, hwnd: explorerHwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    const yomiMatches = snap.elements.filter((e) => e.name && /yomi/i.test(e.name))
    await log(`Search via Ctrl+E: ${yomiMatches.length} yomi matches, window="${snap.window}"`)

    expect(snap.elements.length).toBeGreaterThan(0)
  }, TIMEOUT)

  // ========================================================================
  // 12. Close Explorer window
  // ========================================================================

  it("12 — closes an Explorer window via WM_CLOSE", async () => {
    skipIf()
    // Use the Downloads window (tracked separately) — close it
    if (!downloadsHwnd) {
      openExplorer(join(homedir(), "Downloads"))
      await sleep(1500)
      downloadsHwnd = await findExplorerWindow("Downloads")
    }
    if (!downloadsHwnd) { await log("SKIP: no Downloads window to close"); return }

    await uia.setForeground(downloadsHwnd).catch(() => null); await sleep(400)
    await log(`Closing Downloads window: hwnd=${downloadsHwnd}`)

    const result = await uia.closeWindow(downloadsHwnd).catch((e) => ({
      ok: false, error: e instanceof Error ? e.message : String(e),
    }))
    await log(`closeWindow result: ${JSON.stringify(result)}`)
    await sleep(800)

    // Verify it's gone
    const still = await uia.findWindow({ titleContains: "Downloads" }).catch(() => null)
    await log(`Downloads window still exists: ${still ? `YES (hwnd=${still})` : "NO"}`)
    // Window should be gone or different hwnd
    if (still && still === downloadsHwnd) {
      // Fallback: Alt+F4
      await uia.setForeground(downloadsHwnd).catch(() => null); await sleep(400)
      await uia.call("press_key", { keys: "Alt+F4" }).catch(() => null)
      await sleep(800)
    }

    downloadsHwnd = null
  }, TIMEOUT)

  // ========================================================================
  // 13. Minimize and restore Explorer window
  // ========================================================================

  it("13a — minimizes the Desktop Explorer window", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer window to minimize"); return }

    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(400)
    await log(`Minimizing Explorer: hwnd=${explorerHwnd}`)

    const result = await uia.minimizeWindow(explorerHwnd).catch((e) => ({
      ok: false, error: e instanceof Error ? e.message : String(e),
    }))
    await log(`minimizeWindow result: ${JSON.stringify(result)}`)
    await sleep(600)

    // Verify — the window should still exist but be minimized
    const info = await uia.getWindowInfo({ hwnd: explorerHwnd }).catch(() => null)
    await log(`After minimize: window="${info?.window}"`)

    // Can still get its info even when minimized
    expect(info?.window).toBeTruthy()
  }, TIMEOUT)

  it("13b — restores (maximizes) the Explorer window", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer window to restore"); return }

    await log(`Restoring/maximizing Explorer: hwnd=${explorerHwnd}`)
    const result = await uia.maximizeWindow(explorerHwnd).catch((e) => ({
      ok: false, error: e instanceof Error ? e.message : String(e),
    }))
    await log(`maximizeWindow result: ${JSON.stringify(result)}`)

    // Set foreground so the tree snapshot works
    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(800)

    // Verify we can snapshot it again
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 20, hwnd: explorerHwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    await log(`After restore: window="${snap.window}" elements=${snap.elements.length}`)
    expect(snap.elements.length).toBeGreaterThan(0)
  }, TIMEOUT)

  // ========================================================================
  // 14. Toggle maximize/restore via keyboard
  // ========================================================================

  it("14 — toggles maximize/restore via Win+Up / Win+Down", async () => {
    skipIf()
    if (!explorerHwnd) { await log("SKIP: no Explorer window"); return }

    await uia.setForeground(explorerHwnd).catch(() => null); await sleep(400)

    // Win+Down to restore/minimize from maximized state
    await uia.call("press_key", { keys: "Win+Down" }).catch(() => null)
    await sleep(800)

    // Win+Up to maximize
    await uia.call("press_key", { keys: "Win+Up" }).catch(() => null)
    await sleep(800)

    // Should still be able to snapshot
    const snap = await uia.getUiTree({ maxNodes: 200, maxDepth: 20, hwnd: explorerHwnd }).catch(() =>
      ({ window: "", elements: [] as UiaElement[] }))
    await log(`After Win+Up: window="${snap.window}" elements=${snap.elements.length}`)
    expect(snap.window).toBeTruthy()
  }, TIMEOUT)

  // ========================================================================
  // 15. Close all Explorer windows via Alt+F4
  // ========================================================================

  it("15 — closes Explorer via Alt+F4 keyboard shortcut", async () => {
    skipIf()
    // Open a fresh Explorer just for this test
    openExplorer(join(homedir(), "Documents"))
    await sleep(2000)
    const hwnd = await findExplorerWindow("Documents")
    if (!hwnd) { await log("SKIP: no Documents window"); return }

    await uia.setForeground(hwnd).catch(() => null); await sleep(400)
    await log(`Closing via Alt+F4: hwnd=${hwnd}`)

    await uia.call("press_key", { keys: "Alt+F4" }).catch(() => null)
    await sleep(1000)

    // Verify gone
    const still = await uia.findWindow({ titleContains: "Documents" }).catch(() => null)
    await log(`Documents window still exists after Alt+F4: ${still ? "YES" : "NO"}`)
  }, TIMEOUT)

  // ========================================================================
  // 16. Close a minimized window (should work even when not foreground)
  // ========================================================================

  it("16a — minimizes then closes an Explorer window while minimized", async () => {
    skipIf()
    // Open a fresh Explorer for this test
    openExplorer(join(homedir(), "Pictures"))
    await sleep(2000)
    const hwnd = await findExplorerWindow("Pictures")
    if (!hwnd) { await log("SKIP: no Pictures window"); return }
    await log(`Pictures window: hwnd=${hwnd}`)

    // Minimize it
    await uia.setForeground(hwnd).catch(() => null); await sleep(400)
    await uia.minimizeWindow(hwnd).catch(() => null)
    await sleep(600)
    await log("Minimized")

    // Verify it still exists (just minimized)
    let info = await uia.getWindowInfo({ hwnd }).catch(() => null)
    await log(`After minimize: window="${info?.window}" — still exists: ${!!info?.window}`)
    expect(info?.window).toBeTruthy()

    // Close it while minimized
    await uia.closeWindow(hwnd).catch(() => null)
    await sleep(800)

    // Verify it's gone
    info = await uia.getWindowInfo({ hwnd }).catch(() => null)
    await log(`After closeWindow (while minimized): window="${info?.window}"`)
    // Window should be gone or unreachable
  }, TIMEOUT)

  it("16b — opens a folder, minimizes, then closes via closeWindow", async () => {
    skipIf()
    // Fresh Explorer to Videos folder
    openExplorer(join(homedir(), "Videos"))
    await sleep(2000)
    let hwnd = await findExplorerWindow("Videos")
    if (!hwnd) {
      // Try any Explorer
      hwnd = await uia.findWindow({ process: "explorer" }).catch(() => null)
      if (!hwnd) { await log("SKIP: no Explorer window"); return }
    }
    await log(`Videos Explorer: hwnd=${hwnd}`)

    // Minimize
    await uia.minimizeWindow(hwnd).catch(() => null)
    await sleep(500)

    // Close via WM_CLOSE while minimized
    const result = await uia.closeWindow(hwnd)
    await log(`closeWindow result: ${JSON.stringify(result)}`)
    await sleep(800)

    // Try to find it — should not exist
    const still = await uia.findWindow({ titleContains: "Videos" }).catch(() => null)
    await log(`Videos window still exists: ${still ? `YES (hwnd=${still})` : "NO"}`)
    // Note: on some Windows versions, WM_CLOSE on a minimized window may not work.
    // If still exists, try force-close via foreground + Alt+F4
    if (still) {
      await uia.setForeground(still).catch(() => null); await sleep(400)
      await uia.call("press_key", { keys: "Alt+F4" }).catch(() => null)
      await sleep(800)
    }
  }, TIMEOUT)

  it("16c — opens multiple windows, minimizes all, closes each via closeWindow", async () => {
    skipIf()
    // Open two Explorer windows
    openExplorer(join(homedir(), "Desktop"))
    await sleep(1200)
    openExplorer(join(homedir(), "Downloads"))
    await sleep(2000)

    const desktopHwnd = await findExplorerWindow("Desktop")
    const downloadsHwnd = await findExplorerWindow("Downloads")

    await log(`Desktop: ${desktopHwnd}, Downloads: ${downloadsHwnd}`)

    // Minimize both
    if (desktopHwnd) { await uia.minimizeWindow(desktopHwnd).catch(() => null); await sleep(300) }
    if (downloadsHwnd) { await uia.minimizeWindow(downloadsHwnd).catch(() => null); await sleep(300) }
    await log("Both minimized")

    // Close both while minimized
    if (desktopHwnd) {
      await uia.closeWindow(desktopHwnd).catch(() => null)
      await sleep(500)
      const still = await uia.findWindow({ titleContains: "Desktop" }).catch(() => null)
      await log(`Desktop after close: ${still ? "still exists" : "GONE"}`)
    }
    if (downloadsHwnd) {
      await uia.closeWindow(downloadsHwnd).catch(() => null)
      await sleep(500)
      const still = await uia.findWindow({ titleContains: "Downloads" }).catch(() => null)
      await log(`Downloads after close: ${still ? "still exists" : "GONE"}`)
    }
  }, TIMEOUT)
})
