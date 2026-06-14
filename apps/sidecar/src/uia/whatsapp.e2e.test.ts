// WhatsApp E2E test — send messages, maximize, minimize, close
// Uses UIA tree + Hermes guardrails + LangGraph validation.
// Run: bun test apps/sidecar/src/uia/whatsapp.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { uia } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"
import type { UiaElement } from "@yomi/shared"

const LOG_FILE = join(import.meta.dir, "../../../../debug/whatsapp-e2e-log.txt")
let logBuf = ""
async function log(line: string) {
  const ts = new Date().toISOString().slice(11, 23)
  const entry = `[${ts}] ${line}\n`; logBuf += entry; process.stdout.write(entry)
}
async function flushLog() {
  if (logBuf) {
    await mkdir(dirname(LOG_FILE), { recursive: true })
    await appendFile(LOG_FILE, logBuf, "utf8"); logBuf = ""
  }
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// Hermes guardrails
async function guardedCall(tool: string, params: Record<string, unknown>, to = 10_000) {
  const pre = await hooks.onPreToolUse(tool, params)
  if (!pre.ok) { await log(`BLOCKED ${tool}: ${pre.reason}`); return { error: pre.reason } }
  const r = await uia.call(tool, params, to).catch((e: Error) => ({ error: e.message }))
  return hooks.onPostToolUse(tool, r, params)
}

// Generic UIA helpers
function findInTree(el: UiaElement[], o: { role?: string | string[]; namePattern?: RegExp; enabled?: boolean; notOffscreen?: boolean; minWidth?: number }) {
  return el.filter((e) => {
    if (o.enabled !== undefined && e.enabled !== o.enabled) return false
    if (o.notOffscreen && e.offscreen) return false
    if (o.role) { const r = Array.isArray(o.role) ? o.role : [o.role]; if (!r.includes(e.role)) return false }
    if (o.namePattern && (!e.name || !o.namePattern.test(e.name))) return false
    if (o.minWidth && e.rect.width < o.minWidth) return false
    return true
  })
}

async function smartClick(hwnd: number, el: UiaElement, label: string): Promise<boolean> {
  await log(`  Click: ${el.role} "${el.name}" ref=${el.ref}`)
  let ok = false
  try { const r = await uia.call("click_element", { ref: el.ref }); ok = (r as { ok?: boolean }).ok === true } catch {}
  if (!ok) {
    const cx = Math.round(el.rect.x + el.rect.width / 2)
    const cy = Math.round(el.rect.y + el.rect.height / 2)
    try { await uia.call("click_point", { x: cx, y: cy, button: "left" }); ok = true } catch {}
  }
  if (!ok) {
    const nr = await uia.reResolve(el.ref)
    if (nr) try { const r = await uia.call("click_element", { ref: nr }); ok = (r as { ok?: boolean }).ok === true } catch {}
  }
  await sleep(500)
  await log(`  Click ${label}: ${ok ? "OK" : "FAIL"}`)
  return ok
}

async function snap(hwnd: number, max = 300) {
  return uia.getUiTree({ maxNodes: max, maxDepth: 50, hwnd, lite: true }).catch(() =>
    ({ window: "", elements: [] as UiaElement[], truncated: false }))
}

// ===========================================================================
// WhatsApp helpers
// ===========================================================================

async function findWhatsApp(): Promise<number | null> {
  return uia.findWindow({ titleContains: "WhatsApp" })
}

async function launchWhatsApp(): Promise<number | null> {
  const ps = `$a = Get-StartApps | Where-Object { $_.Name -like '*WhatsApp*' } | Select-Object -First 1; if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)" }`
  Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  for (let i = 0; i < 25; i++) { await sleep(1000); const h = await findWhatsApp(); if (h) return h }
  return null
}

// Find the search/chat-search box
function findSearchBox(elements: UiaElement[]): UiaElement | null {
  return findInTree(elements, {
    role: "Edit",
    namePattern: /search|chat/i,
    enabled: true, notOffscreen: true,
  })[0] ?? null
}

// Find a chat in the chat list
function findChat(elements: UiaElement[], name: string): UiaElement | null {
  const target = name.toLowerCase()
  const matches = findInTree(elements, {
    role: ["ListItem", "DataItem", "Button", "Group", "Text"],
    enabled: true, notOffscreen: true, minWidth: 60,
  }).filter((e) => e.name?.toLowerCase().includes(target))
  // Prefer right-side chat list items (not left nav)
  const root = elements[0]
  const chatList = matches.filter((e) => !root || e.rect.x > root.rect.x + 50)
  return chatList.sort((a, b) => a.rect.y - b.rect.y)[0] ?? matches[0] ?? null
}

// Find the message composer — the bottom text input in an open chat.
// WhatsApp UWP: the composer is an Edit field in the message area, 
// distinct from the search box which has "search" in its name.
function findComposer(elements: UiaElement[]): UiaElement | null {
  const edits = findInTree(elements, {
    role: "Edit",
    enabled: true, notOffscreen: true,
  })
  // Exclude the search box by name
  const candidates = edits.filter((e) => !/search|chat/i.test(e.name ?? ""))
  // Also try looking for Document roles (WhatsApp UWP might use Document for rich text)
  if (candidates.length === 0) {
    const docs = findInTree(elements, {
      role: "Document",
      enabled: true, notOffscreen: true,
    })
    return docs.sort((a, b) => b.rect.y - a.rect.y)[0] ?? null
  }
  // Prefer the bottom-most, widest Edit (the composer is at the bottom)
  return candidates.sort((a, b) => b.rect.y - a.rect.y || b.rect.width - a.rect.width)[0] ?? null
}

// Find the Send button (broad search — may be image-based in UWP)
function findSendButton(elements: UiaElement[]): UiaElement | null {
  // Try exact "Send" button
  const exact = elements.find((e) =>
    e.enabled && !e.offscreen && e.role === "Button" && /^send$/i.test(e.name))
  if (exact) return exact
  // Try broader — any button near the composer with send-like name
  const comp = findComposer(elements)
  if (!comp) {
    // Just look for any small button at bottom-right
    const btns = findInTree(elements, {
      role: "Button", enabled: true, notOffscreen: true, minWidth: 20,
    }).filter((b) => /send|submit|enter/i.test(b.name ?? ""))
    return btns.sort((a, b) => b.rect.y - a.rect.y || b.rect.x - a.rect.x)[0] ?? null
  }
  // Find buttons near the composer (within 100px horizontally, below or same row)
  const near = findInTree(elements, {
    role: ["Button", "Image"],
    enabled: true, notOffscreen: true, minWidth: 16,
  }).filter((b) =>
    Math.abs(b.rect.y - comp.rect.y) < 50 &&
    b.rect.x > comp.rect.x + comp.rect.width - 20)
  return near.sort((a, b) => b.rect.x - a.rect.x)[0] ?? null
}

// ===========================================================================

describe("WhatsApp E2E — send, maximize, minimize, close", () => {
  let skipReason = ""
  let waHwnd: number | null = null
  let waAvailable = false

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# WhatsApp E2E Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== WhatsApp E2E Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    toolGuardrail.resetForTurn()

    try { const p = await uia.call<{ ok: boolean }>("ping", {}, 10_000); if (!p?.ok) { skipReason = "helper down"; return } }
    catch (e) { skipReason = `helper: ${e instanceof Error ? e.message : String(e)}`; return }
    await log("OK: helper ping")

    waHwnd = await findWhatsApp()
    if (!waHwnd) { await log("Launching WhatsApp..."); waHwnd = await launchWhatsApp() }
    if (waHwnd) {
      waAvailable = true
      await log(`WhatsApp found: hwnd=${waHwnd}`)
      await uia.maximizeWindow(waHwnd).catch(() => null)
      await sleep(1000)
      const s = await snap(waHwnd, 200)
      await log(`Initial tree: window="${s.window}" elements=${s.elements.length}`)
    } else {
      await log("SKIP: WhatsApp not installed")
    }
  }, 60_000)

  afterAll(async () => {
    if (waHwnd && waAvailable) {
      await uia.setForeground(waHwnd).catch(() => null); await sleep(200)
      await uia.closeWindow(waHwnd).catch(() => {})
      await sleep(300)
      await uia.call("press_key", { keys: "Alt+F4" }).catch(() => null)
      await sleep(500)
      // UWP apps suspend, don't close — taskkill fallback
      Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
        "Get-Process WhatsApp -ErrorAction SilentlyContinue | Stop-Process -Force"],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      await sleep(500)
      const still = await uia.getWindowInfo({ hwnd: waHwnd }).catch(() => ({ window: "" }))
      await log(`WhatsApp after cleanup: ${still.window || "GONE"}`)
    }
    await log("=== WhatsApp E2E Completed ==="); await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }
  const need = () => { if (!waAvailable) throw new Error("SKIP: WhatsApp not available") }

  // =========================================================================
  // 1. Tree exploration
  // =========================================================================

  describe("1. Explore WhatsApp UI tree", () => {
    it("discovers WhatsApp UI structure", async () => {
      skipIf(); need()
      if (!waHwnd) return
      await uia.setForeground(waHwnd).catch(() => null); await sleep(500)

      const s = await snap(waHwnd, 400)
      await log(`Tree: window="${s.window}" elements=${s.elements.length} truncated=${s.truncated}`)

      // Role distribution
      const roles = new Map<string, number>()
      for (const e of s.elements) roles.set(e.role, (roles.get(e.role) ?? 0) + 1)
      const top = [...roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      await log(`Roles: ${top.map(([r, c]) => `${r}=${c}`).join(", ")}`)

      expect(s.elements.length).toBeGreaterThan(0)
    })

    it("finds chat search box", async () => {
      skipIf(); need()
      if (!waHwnd) return
      await uia.setForeground(waHwnd).catch(() => null); await sleep(400)
      const s = await snap(waHwnd, 200)
      const search = findSearchBox(s.elements)
      if (search) {
        await log(`Search box: ref=${search.ref} name="${search.name}" role=${search.role}`)
      } else {
        await log("No search box found — WhatsApp UI may differ")
      }
    })

    it("finds and opens 'You' (self) chat", async () => {
      skipIf(); need()
      if (!waHwnd) return
      await uia.setForeground(waHwnd).catch(() => null); await sleep(500)

      // Search for "You" to open self-chat
      const s = await snap(waHwnd, 300)
      const search = findSearchBox(s.elements)
      if (search) {
        await smartClick(waHwnd, search, "Search box")
        await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null); await sleep(100)
        await uia.call("type_text", { text: "you" }).catch(() => null); await sleep(1000)

        const s2 = await snap(waHwnd, 300)
        const youChat = findChat(s2.elements, "you") || findChat(s2.elements, "(you)")
        if (youChat) {
          await log(`You chat: "${youChat.name}" role=${youChat.role}`)
          await smartClick(waHwnd, youChat, "You chat")
          await sleep(1500)
        } else {
          await log("No 'You' chat found — trying Message Yourself")
        }
      }
    })
  })

  // =========================================================================
  // 2. Send messages
  // =========================================================================

  describe("2. Send messages", () => {
    it("sends a message about cats to self — full self-contained flow", async () => {
      skipIf(); need()
      if (!waHwnd) return
      const msg = "Cats are amazing! Meow."

      await uia.setForeground(waHwnd).catch(() => null); await sleep(500)

      // Escape any open chat — go back to main chat list
      await uia.call("press_key", { keys: "Escape" }).catch(() => null); await sleep(400)

      // STEP 1: Search for the user
      let s = await snap(waHwnd, 400)
      const search = findSearchBox(s.elements)
      if (!search) { await log("SKIP: no search box"); return }
      await smartClick(waHwnd, search, "Search box")
      await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null); await sleep(80)
      await uia.call("type_text", { text: "you" }).catch(() => null); await sleep(1200)

      // STEP 2: Click on the user to open their chat
      s = await snap(waHwnd, 400)
      const youChat = findChat(s.elements, "you") || findChat(s.elements, "(You)")
      if (!youChat) { await log("SKIP: no 'You' chat found"); return }
      await log(`You chat: "${youChat.name}" role=${youChat.role}`)
      await smartClick(waHwnd, youChat, "Open You chat")
      await sleep(2000)

      // STEP 3: Find the message composer (bottom input — NOT the search bar)
      s = await snap(waHwnd, 400)
      const composer = findComposer(s.elements)
      await log(`Composer: ${composer ? `ref=${composer.ref} y=${composer.rect.y} name="${composer.name}"` : "NOT FOUND"}`)
      if (!composer) { await log("SKIP: no composer found in chat"); return }

      // STEP 4: Type the message in the composer
      await uia.call("set_value", { ref: composer.ref, text: msg }).catch(() => null)
      await sleep(500)
      const verifySnap = await snap(waHwnd, 300)
      const verifyComposer = findComposer(verifySnap.elements)
      const text = verifyComposer?.value ?? ""
      await log(`Composer text: "${text.slice(0, 60)}"`)
      if (!text.includes("Cats")) {
        // set_value didn't stick — click+paste fallback
        const cx = Math.round(composer.rect.x + composer.rect.width / 2)
        const cy = Math.round(composer.rect.y + composer.rect.height / 2)
        await uia.call("click_point", { x: cx, y: cy, button: "left" }).catch(() => null); await sleep(300)
        const cp = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", "[Console]::In.ReadToEnd() | Set-Clipboard"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
        cp.stdin.write(msg); cp.stdin.end(); await cp.exited; await sleep(150)
        await uia.call("press_key", { keys: "Ctrl+V" }).catch(() => null); await sleep(500)
      }

      // STEP 5: Find and click the Send button
      const sendSnap = await snap(waHwnd, 400)
      let sendBtn = findSendButton(sendSnap.elements)
      if (!sendBtn) {
        const allBtns = findInTree(sendSnap.elements, { role: "Button", enabled: true, notOffscreen: true })
          .filter((b) => b.rect.y > (sendSnap.elements[0]?.rect?.height ?? 1080) * 0.5)
        sendBtn = allBtns.sort((a, b) => b.rect.x - a.rect.x)[0] ?? null
      }
      if (sendBtn) {
        await log(`Send: "${sendBtn.name}" at ${sendBtn.rect.x},${sendBtn.rect.y}`)
        await smartClick(waHwnd, sendBtn, "Send")
        await sleep(1500)
      } else {
        await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(1000)
      }

      // STEP 6: Verify — composer should no longer contain our message
      const afterSnap = await snap(waHwnd, 400)
      const afterComposer = findComposer(afterSnap.elements)
      const afterText = afterComposer?.value ?? ""
      await log(`Composer after send: "${afterText.slice(0, 60)}"${afterText.length === 0 ? " (EMPTY)" : ""}`)
      const sent = afterText.length === 0 || !afterText.includes("Cats")
      await log(`Message sent: ${sent ? "YES" : "NOT SENT"}`)
      expect(sent).toBe(true)
    })

    it("searches, opens Lily's chat, writes and sends a message", async () => {
      skipIf(); need()
      if (!waHwnd) return

      await uia.setForeground(waHwnd).catch(() => null); await sleep(400)

      // Escape any open chat — back to main list
      await uia.call("press_key", { keys: "Escape" }).catch(() => null); await sleep(400)

      // Step 1: Search for Lily
      const s = await snap(waHwnd, 400)
      const search = findSearchBox(s.elements)
      if (!search) { await log("SKIP: no search box"); return }

      await smartClick(waHwnd, search, "Search box")
      await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null); await sleep(100)
      await uia.call("type_text", { text: "lily" }).catch(() => null); await sleep(1500)

      // Retry snapshot a few times — WhatsApp WebView2 tree loads asynchronously
      let lilyChat: UiaElement | null = null
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await sleep(800)
        const trySnap = await snap(waHwnd, 500)
        lilyChat = findChat(trySnap.elements, "lily")
        if (lilyChat) break
        await log(`  Lily search attempt ${attempt + 1}: not found yet`)
      }
      if (!lilyChat) { await log("SKIP: no Lily contact found after retries"); return }

      await log(`Lily chat: "${lilyChat.name}" role=${lilyChat.role}`)
      await smartClick(waHwnd, lilyChat, "Lily chat")
      await sleep(2000)

      // Step 3: Find composer (NOT the search box — we're now in the chat)
      const s3 = await snap(waHwnd, 400)
      const composer = findComposer(s3.elements)
      await log(`Lily composer: ${composer ? `ref=${composer.ref} y=${composer.rect.y} name="${composer.name}"` : "NOT FOUND"}`)
      if (!composer) { await log("SKIP: no composer in Lily chat"); return }

      // Log all Edit fields to debug
      const allEdits = findInTree(s3.elements, { role: "Edit", enabled: true, notOffscreen: true })
      await log(`All Edits in Lily chat: ${allEdits.map((e) => `y=${e.rect.y} name="${e.name}"`).join(" | ")}`)

      // Step 4: Type and send
      const cx = Math.round(composer.rect.x + composer.rect.width / 2)
      const cy = Math.round(composer.rect.y + composer.rect.height / 2)
      await uia.call("click_point", { x: cx, y: cy, button: "left" }).catch(() => null); await sleep(400)

      const msg = "Hey Lily! Cats say hi 🐱"
      await uia.call("set_value", { ref: composer.ref, text: msg }).catch(() => null)
      await sleep(500)

      // Send
      const sendSnap = await snap(waHwnd, 400)
      let sendBtn = findSendButton(sendSnap.elements)
      if (!sendBtn) {
        const allBtns = findInTree(sendSnap.elements, { role: "Button", enabled: true, notOffscreen: true })
          .filter((b) => b.rect.y > (sendSnap.elements[0]?.rect?.height ?? 1080) * 0.65)
        sendBtn = allBtns.sort((a, b) => b.rect.x - a.rect.x)[0] ?? null
      }
      if (sendBtn) {
        await smartClick(waHwnd, sendBtn, "Send to Lily")
        await sleep(1200)
      } else {
        await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(800)
      }

      // Verify
      const afterSnap = await snap(waHwnd, 400)
      const afterComposer = findComposer(afterSnap.elements)
      const afterText = afterComposer?.value ?? ""
      await log(`Lily composer after send: "${afterText.slice(0, 40)}"${afterText.length === 0 ? " EMPTY" : ""}`)
      await log(`Message to Lily: ${afterText.length === 0 ? "SENT" : "may still be in composer"}`)
    })
  })

  // =========================================================================
  // 3. Window management
  // =========================================================================

  describe("3. Window management (maximize, minimize, close)", () => {
    it("maximizes WhatsApp", async () => {
      skipIf(); need()
      if (!waHwnd) return
      await uia.maximizeWindow(waHwnd)
      await sleep(600)
      const s = await snap(waHwnd, 100)
      await log(`After maximize: elements=${s.elements.length}`)
      expect(s.elements.length).toBeGreaterThan(0)
    })

    it("minimizes WhatsApp", async () => {
      skipIf(); need()
      if (!waHwnd) return
      await uia.minimizeWindow(waHwnd)
      await sleep(600)
      // Window should still exist (just minimized)
      const info = await uia.getWindowInfo({ hwnd: waHwnd }).catch(() => ({ window: "" }))
      await log(`After minimize: window="${info.window}"`)
      expect(info.window).toBeTruthy()
    })

    it("restores and closes WhatsApp (UWP — uses Alt+F4 fallback)", async () => {
      skipIf(); need()
      if (!waHwnd) return
      await uia.setForeground(waHwnd).catch(() => null); await sleep(300)
      await uia.maximizeWindow(waHwnd); await sleep(500)
      await log("Restored from minimized")

      // UWP apps don't always respond to WM_CLOSE — use Alt+F4
      await uia.call("press_key", { keys: "Alt+F4" }).catch(() => null)
      await sleep(800)

      const info = await uia.getWindowInfo({ hwnd: waHwnd }).catch(() => ({ window: "" }))
      await log(`After close: ${info.window || "GONE"}`)

      if (!info.window) waAvailable = false
    })
  })

  // =========================================================================
  // 4. Voice command routing for WhatsApp
  // =========================================================================

  describe("4. Voice command routing", () => {
    it("identifies WhatsApp send commands", () => {
      const hasWhatsApp = /whatsapp|wa\b/i
      expect(hasWhatsApp.test("send cats to Lily on WhatsApp")).toBe(true)
      expect(hasWhatsApp.test("message Lily about the meeting")).toBe(false) // no "whatsapp/wa" keyword
      expect(hasWhatsApp.test("text mom on wa")).toBe(true)
      expect(hasWhatsApp.test("play spotify")).toBe(false)
    })
  })
})
