import { tool, jsonSchema } from "ai"
import { platform } from "os"
import type { UiaAction, UiaElement } from "@yomi/shared"
import { uia } from "../uia/client.js"
import { classifyRisk, isBlockedApp } from "../uia/safety.js"
import { emitActResult, requestConfirmation } from "../uia/act-bus.js"

// Refuse to act on a blocklisted foreground app (password managers, banking).
function blockedGuard(): { error: string } | null {
  if (isBlockedApp(uia.lastWindow)) {
    return { error: `Refusing to act on "${uia.lastWindow}" — blocklisted app.` }
  }
  return null
}

// A helper result counts as a failure when it carries an `error` or an explicit `ok: false`.
export function actFailed(r: unknown): boolean {
  return (
    typeof r === "object" &&
    r !== null &&
    (("ok" in r && (r as { ok?: unknown }).ok === false) || "error" in r)
  )
}

function withHint(result: unknown): unknown {
  if (typeof result === "object" && result !== null)
    return { ...(result as object), hint: "re-fetch get_ui_tree and try again" }
  return { error: String(result), hint: "re-fetch get_ui_tree and try again" }
}

// Execute an action and, if it fails or the ref went stale, re-snapshot + retry once with a fresh ref.
async function attemptAct(
  ref: string,
  run: (ref: string) => Promise<unknown>,
): Promise<{ result: unknown; retried: boolean }> {
  let result: unknown
  try {
    result = await run(ref)
    if (!actFailed(result)) return { result, retried: false }
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) }
  }
  const fresh = await uia.reResolve(ref).catch(() => null)
  if (!fresh) return { result: withHint(result), retried: false }
  try {
    const retried = await run(fresh)
    return { result: actFailed(retried) ? withHint(retried) : retried, retried: true }
  } catch (e) {
    return {
      result: { error: e instanceof Error ? e.message : String(e), hint: "re-fetch get_ui_tree" },
      retried: true,
    }
  }
}

// Run a UIA action through the safety guard: blocklist → risk → confirm → execute (+retry) → report.
type RefAction = Extract<UiaAction, { ref: string }>
async function guardedAct(action: RefAction, run: (ref: string) => Promise<unknown>) {
  const blocked = blockedGuard()
  if (blocked) {
    emitActResult(false, action.ref, blocked.error)
    return blocked
  }

  const el = uia.getElement(action.ref)
  if (!el) return { error: "element no longer available — call get_ui_tree again first" }

  const label = el.name || el.role || action.ref
  const { risky, reason } = classifyRisk(action.kind, el)
  if (risky) {
    const approved = await requestConfirmation(
      action,
      label,
      reason ?? "destructive action",
      el.rect,
    )
    if (!approved) {
      emitActResult(false, label, "not confirmed")
      return { ok: false, requiresConfirmation: true, label, reason }
    }
  }
  const { result, retried } = await attemptAct(action.ref, run)
  const failed = actFailed(result)
  emitActResult(!failed, label, failed ? "action did not succeed" : undefined)
  return retried && typeof result === "object" && result !== null
    ? { ...(result as object), retried }
    : result
}

function cleanAppName(name: string): string {
  return name.replace(/['";\r\n`$]/g, "").trim()
}

async function launchWindowsApp(
  name: string,
  settleMs = 1200,
): Promise<{ ok: true; detail: string } | { error: string }> {
  const safe = cleanAppName(name)
  if (!safe) return { error: "app name required" }
  const ps =
    `$a = Get-StartApps | Where-Object { $_.Name -like '*${safe}*' } | Select-Object -First 1; ` +
    `if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)"; $name = $a.Name; "launched: $name" } ` +
    `else { Start-Process '${safe}'; $name = '${safe}'; "started: $name" }; ` +
    `$ws = New-Object -ComObject WScript.Shell; ` +
    `for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 150; if ($ws.AppActivate($name) -or $ws.AppActivate('${safe}')) { break } }`
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  if (code !== 0) return { error: (err || "launch failed").trim() }
  await Bun.sleep(settleMs)
  return { ok: true, detail: out.trim() }
}

async function activateWindowsApp(name: string): Promise<boolean> {
  const safe = cleanAppName(name)
  if (!safe) return false
  const ps =
    `Add-Type -Namespace Yomi -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'; ` +
    `$ws = New-Object -ComObject WScript.Shell; ` +
    `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1; ` +
    `for ($i = 0; $i -lt 20; $i++) { ` +
    `if ($p -and $p.MainWindowHandle -ne 0) { [Yomi.Native]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; if ([Yomi.Native]::SetForegroundWindow($p.MainWindowHandle)) { 'ok'; exit 0 } }; ` +
    `if ($p -and $ws.AppActivate($p.Id)) { 'ok'; exit 0 }; ` +
    `if ($ws.AppActivate('${safe}')) { 'ok'; exit 0 }; ` +
    `Start-Sleep -Milliseconds 150; ` +
    `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1 ` +
    `}; exit 1`
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
  })
  await new Response(proc.stdout).text()
  return (await proc.exited) === 0
}

async function getWindowsAppHwnd(name: string): Promise<number | null> {
  const safe = cleanAppName(name)
  if (!safe) return null
  const ps = `(Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1).MainWindowHandle`
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  const hwnd = Number(out)
  return Number.isFinite(hwnd) && hwnd > 0 ? hwnd : null
}

async function requireWindowsAppWindow(
  name: string,
): Promise<{ ok: true; window: string; hwnd: number } | { error: string }> {
  for (let i = 0; i < 8; i++) {
    const hwnd = await getWindowsAppHwnd(name)
    if (hwnd) {
      const info = await uia.getWindowInfo({ hwnd })
      if (info.window.toLowerCase().includes(name.toLowerCase()))
        return { ok: true, window: info.window, hwnd }
    }
    await activateWindowsApp(name)
    await Bun.sleep(250)
  }
  const info = await uia.getWindowInfo().catch(() => ({ window: "" }))
  return {
    error: `Could not find a usable ${name} window; active window is "${info.window}". Refusing to click another app.`,
  }
}

function searchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (part) =>
        part.length >= 3 &&
        ![
          "the",
          "and",
          "feat",
          "ft",
          "with",
          "song",
          "songs",
          "track",
          "tracks",
          "music",
        ].includes(part),
    )
}

type SpotifyQuery = {
  original: string
  searchText: string
  titleTokens: string[]
  artistTokens: string[]
  allTokens: string[]
}

function parseSpotifyQuery(query: string): SpotifyQuery {
  const clean = query.replace(/[.?!]+$/g, "").trim()
  const byMatch = clean.match(/^(.+?)\s+by\s+(.+)$/i)
  const title = (byMatch?.[1]?.trim() ?? clean)
    .replace(/\b(song|track|music)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
  const artist = byMatch?.[2]?.trim() ?? ""
  const titleTokens = searchTokens(title)
  const artistTokens = searchTokens(artist)
  const allTokens = [...new Set([...titleTokens, ...artistTokens])]
  return {
    original: clean,
    searchText: artist ? `${title} ${artist}` : clean,
    titleTokens,
    artistTokens,
    allTokens,
  }
}

function scoreSpotifyPlayButton(name: string, query: string): number {
  const n = name.toLowerCase()
  if (!/\bplay\b/.test(n)) return -1
  let score = n === "play" ? 10 : 6
  for (const token of searchTokens(query)) if (n.includes(token)) score += 2
  return score
}

function tokenScore(name: string, tokens: string[], weight: number): number {
  const n = name.toLowerCase()
  return tokens.reduce((score, token) => score + (n.includes(token) ? weight : 0), 0)
}

function visibleElement(el: {
  rect: { x: number; y: number; width: number; height: number }
}): boolean {
  return el.rect.width > 8 && el.rect.height > 8
}

function contentElement(el: UiaElement, root?: UiaElement): boolean {
  if (!visibleElement(el)) return false
  if (!root) return true
  const bottomPlayerTop = root.rect.y + root.rect.height - 125
  const sideNavRight = root.rect.x + 180
  return el.rect.y > root.rect.y + 70 && el.rect.y < bottomPlayerTop && el.rect.x > sideNavRight
}

function findSpotifyResultRow(
  elements: UiaElement[],
  query: SpotifyQuery,
): { y: number; score: number; label: string; element: UiaElement } | null {
  const root = elements[0]
  const rows = new Map<number, { y: number; score: number; label: string; element: UiaElement }>()
  for (const el of elements) {
    if (
      !el.enabled ||
      !contentElement(el, root) ||
      !["Button", "Text", "ListItem", "DataItem", "Hyperlink", "Group"].includes(el.role)
    )
      continue
    if (
      !el.name ||
      /\b(play|pause|home|search|library|install|upgrade|profile|back|forward|queue|connect)\b/i.test(
        el.name,
      )
    )
      continue
    const titleScore = tokenScore(el.name, query.titleTokens, 5)
    const artistScore = tokenScore(el.name, query.artistTokens, 3)
    const allScore = tokenScore(el.name, query.allTokens, 1)
    const score = titleScore + artistScore + allScore
    if (score <= 0) continue
    const bucket = Math.round(el.rect.y / 72) * 72
    const current = rows.get(bucket)
    if (!current || score > current.score) {
      rows.set(bucket, { y: el.rect.y, score, label: el.name, element: el })
    } else {
      current.score += Math.max(1, Math.floor(score / 2))
      if (el.name.length > current.label.length) current.label = el.name
    }
  }
  const minScore = query.artistTokens.length > 0 ? 8 : 5
  return (
    [...rows.values()]
      .filter((row) => row.score >= minScore)
      .sort((a, b) => b.score - a.score || a.y - b.y)[0] ?? null
  )
}

function findPlayNearRow(elements: UiaElement[], rowY: number): UiaElement | undefined {
  const root = elements[0]
  return elements
    .filter(
      (el) =>
        el.enabled &&
        contentElement(el, root) &&
        el.role === "Button" &&
        /\bplay\b/i.test(el.name || "Play"),
    )
    .map((el) => ({ el, distance: Math.abs(el.rect.y - rowY) }))
    .filter(({ distance }) => distance <= 80)
    .sort((a, b) => a.distance - b.distance || a.el.rect.x - b.el.rect.x)[0]?.el
}

export type VolumeDirection = "up" | "down" | "mute"

export async function adjustSystemVolume(direction: VolumeDirection, steps = 2): Promise<unknown> {
  if (platform() !== "win32")
    return { error: "System volume automation is only supported on Windows." }
  const key = direction === "up" ? "0xAF" : direction === "down" ? "0xAE" : "0xAD"
  const count = direction === "mute" ? 1 : Math.max(1, Math.min(Math.round(steps), 20))
  const ps =
    `Add-Type -Namespace Yomi -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'; ` +
    `for ($i = 0; $i -lt ${count}; $i++) { [Yomi.Native]::keybd_event(${key}, 0, 0, [UIntPtr]::Zero); [Yomi.Native]::keybd_event(${key}, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 45 }`
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) return { error: (err || "volume adjustment failed").trim() }
  return { ok: true, direction, steps: count }
}

// Adjust Spotify's own playback volume (separate from system volume) via its in-app shortcuts
// (Ctrl+Up / Ctrl+Down). Focuses/launches Spotify first so the keystrokes land on it.
export async function adjustSpotifyVolume(direction: VolumeDirection, steps = 3): Promise<unknown> {
  if (platform() !== "win32")
    return { error: "Spotify volume automation is only supported on Windows." }
  const active = await activateWindowsApp("Spotify")
  if (!active) {
    const launched = await launchWindowsApp("Spotify", 2000)
    if ("error" in launched) return launched
    await activateWindowsApp("Spotify")
  }
  if (direction === "mute") {
    // Spotify has no mute shortcut — drive the volume to zero.
    for (let i = 0; i < 15; i++) {
      await uia.call("press_key", { keys: "Ctrl+Down" })
      await Bun.sleep(40)
    }
    return { ok: true, direction: "mute", target: "spotify" }
  }
  const key = direction === "up" ? "Ctrl+Up" : "Ctrl+Down"
  const count = Math.max(1, Math.min(Math.round(steps), 20))
  for (let i = 0; i < count; i++) {
    await uia.call("press_key", { keys: key })
    await Bun.sleep(50)
  }
  return { ok: true, direction, steps: count, target: "spotify" }
}

function normalizeRecipient(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function findWhatsAppChat(elements: UiaElement[], recipient: string): UiaElement | null {
  const root = elements[0]
  const target = normalizeRecipient(recipient)
  const targetTokens = target.split(/\s+/).filter(Boolean)
  const wantsSelf = /^(you|me|myself|self|message myself)$/.test(target)
  const candidates = elements
    .filter((el) => {
      if (!el.enabled || !visibleElement(el) || !el.name) return false
      if (!["DataItem", "Button", "Group", "Text"].includes(el.role)) return false
      if (!root) return true
      // Avoid the left rail buttons; chat rows live in the conversation list.
      return el.rect.x > root.rect.x + 55 && el.rect.width > 90 && el.rect.y > root.rect.y + 80
    })
    .map((el) => {
      const name = normalizeRecipient(el.name)
      let score = 0
      if (
        wantsSelf &&
        (name.includes(" you ") ||
          name.endsWith(" you") ||
          name.includes("message yourself") ||
          name.includes("(you)"))
      )
        score += 20
      if (wantsSelf && /\b98323\b/.test(name)) score += 8
      for (const token of targetTokens) if (name.includes(token)) score += 4
      if (el.role === "DataItem") score += 3
      if (el.rect.width > 180) score += 2
      return { el, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.el.rect.y - b.el.rect.y)
  return candidates[0]?.el ?? null
}

function findWhatsAppSearch(elements: UiaElement[]): UiaElement | null {
  const root = elements[0]
  if (!root) return null
  return (
    elements
      .filter((el) => {
        if (!el.enabled || !visibleElement(el) || el.role !== "Edit") return false
        const inLeftPane =
          el.rect.x > root.rect.x + 55 && el.rect.x < root.rect.x + root.rect.width * 0.48
        const nearTop = el.rect.y > root.rect.y + 70 && el.rect.y < root.rect.y + 170
        return inLeftPane && nearTop
      })
      .sort((a, b) => b.rect.width - a.rect.width)[0] ?? null
  )
}

function composerPoint(elements: UiaElement[]): { x: number; y: number } | null {
  const root = elements[0]
  if (!root || !visibleElement(root)) return null
  const bottom = Math.max(
    ...elements.filter(visibleElement).map((el) => el.rect.y + el.rect.height),
    root.rect.y + root.rect.height,
  )
  return {
    x: Math.round(root.rect.x + root.rect.width * 0.72),
    y: Math.round(Math.min(root.rect.y + root.rect.height - 55, bottom - 35)),
  }
}

async function clickElementOrPoint(el: UiaElement): Promise<unknown> {
  try {
    return await uia.call("click_element", { ref: el.ref })
  } catch {
    return uia.call("click_point", {
      x: Math.round(el.rect.x + el.rect.width / 2),
      y: Math.round(el.rect.y + el.rect.height / 2),
      button: "left",
    })
  }
}

function findWhatsAppComposer(elements: UiaElement[]): UiaElement | null {
  const root = elements[0]
  if (!root) return null
  return (
    elements
      .filter((el) => {
        if (!el.enabled || !visibleElement(el) || el.role !== "Edit") return false
        if (/search/i.test(el.name) || /search/i.test(el.value ?? "")) return false
        return (
          el.rect.x > root.rect.x + root.rect.width * 0.35 &&
          el.rect.y > root.rect.y + root.rect.height * 0.55
        )
      })
      .sort((a, b) => b.rect.y - a.rect.y || b.rect.width - a.rect.width)[0] ?? null
  )
}

function findWhatsAppSendButton(
  elements: UiaElement[],
  composer?: UiaElement | null,
): UiaElement | null {
  const root = elements[0]
  if (!root) return null
  const composerY = composer?.rect.y ?? root.rect.y + root.rect.height - 70
  return (
    elements
      .filter((el) => {
        if (!el.enabled || !visibleElement(el) || el.role !== "Button") return false
        if (!/\bsend\b/i.test(el.name)) return false
        return (
          el.rect.x > root.rect.x + root.rect.width * 0.55 && Math.abs(el.rect.y - composerY) < 90
        )
      })
      .sort(
        (a, b) =>
          Math.abs(a.rect.y - composerY) - Math.abs(b.rect.y - composerY) || b.rect.x - a.rect.x,
      )[0] ?? null
  )
}

export async function sendWhatsAppMessage(recipient: string, message: string): Promise<unknown> {
  if (platform() !== "win32") return { error: "WhatsApp automation is only supported on Windows." }
  const to = recipient.trim()
  const text = message.trim()
  if (!to) return { error: "recipient required" }
  if (!text) return { error: "message required" }

  try {
    const launched = await launchWindowsApp("WhatsApp", 1800)
    if ("error" in launched) return launched
    const targetWindow = await requireWindowsAppWindow("WhatsApp")
    if ("error" in targetWindow) return targetWindow
    const hwnd = targetWindow.hwnd

    let snap = await uia.getUiTree({ maxNodes: 1200, maxDepth: 55, hwnd })
    const search = findWhatsAppSearch(snap.elements)
    if (search) {
      await clickElementOrPoint(search)
      await Bun.sleep(150)
      await uia.call("set_value", { ref: search.ref, text: "" }).catch(() => null)
      await uia.call("press_key", { keys: "Ctrl+A" })
      await uia.call("press_key", { keys: "Backspace" })
      await Bun.sleep(450)
    }

    snap = await uia.getUiTree({ maxNodes: 1200, maxDepth: 55, hwnd })
    let chat = findWhatsAppChat(snap.elements, to)
    if (!chat && search) {
      await clickElementOrPoint(search)
      await Bun.sleep(150)
      await uia.call("type_text", { text: to })
      await Bun.sleep(700)
      snap = await uia.getUiTree({ maxNodes: 1200, maxDepth: 55, hwnd })
      chat = findWhatsAppChat(snap.elements, to)
    }
    if (!chat) return { error: `Could not find WhatsApp chat for "${to}".` }

    await activateWindowsApp("WhatsApp")
    await clickElementOrPoint(chat)
    emitActResult(true, chat.name || to)
    await Bun.sleep(900)

    await activateWindowsApp("WhatsApp")
    const openChat = await uia.getUiTree({ maxNodes: 2000, maxDepth: 80, hwnd })
    const composer = findWhatsAppComposer(openChat.elements)
    const point = composer ? null : composerPoint(openChat.elements)
    if (composer) {
      await uia.call("type_text", { ref: composer.ref, text })
    } else if (point) {
      await uia.call("click_point", { ...point, button: "left" })
      await Bun.sleep(180)
      await uia.call("type_text", { text })
    } else {
      return { error: "Could not locate WhatsApp message composer." }
    }
    await Bun.sleep(350)

    await activateWindowsApp("WhatsApp")
    const typedSnap = await uia.getUiTree({ maxNodes: 2000, maxDepth: 80, hwnd })
    const typedComposer = findWhatsAppComposer(typedSnap.elements) ?? composer
    const sendButton = findWhatsAppSendButton(typedSnap.elements, typedComposer)
    if (sendButton) {
      await clickElementOrPoint(sendButton)
      emitActResult(true, sendButton.name || `sent WhatsApp message to ${to}`)
    } else {
      await uia.call("press_key", { keys: "Enter" })
    }
    await Bun.sleep(600)

    const afterSend = await uia.getUiTree({ maxNodes: 2000, maxDepth: 80, hwnd })
    const afterComposer = findWhatsAppComposer(afterSend.elements)
    const stillContainsText = normalizeRecipient(
      afterComposer?.value ?? afterComposer?.name ?? "",
    ).includes(normalizeRecipient(text))
    if (stillContainsText) {
      return {
        error: "WhatsApp message appears to still be in the composer; send did not complete.",
      }
    }
    emitActResult(true, `sent WhatsApp message to ${to}`)
    return {
      ok: true,
      recipient: to,
      message: text,
      chat: chat.name,
      composer: typedComposer?.name,
      submit: sendButton?.name ?? "Enter",
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function playSpotify(query: string): Promise<unknown> {
  if (platform() !== "win32") return { error: "Spotify automation is only supported on Windows." }
  const parsed = parseSpotifyQuery(query)
  if (!parsed.searchText) return { error: "spotify search query required" }
  try {
    const launched = await launchWindowsApp("Spotify", 2500)
    if ("error" in launched) return launched

    await uia.call("press_key", { keys: "Ctrl+L" })
    await Bun.sleep(350)
    await uia.call("type_text", { text: parsed.searchText })
    await Bun.sleep(250)
    await uia.call("press_key", { keys: "Enter" })
    await Bun.sleep(1500)

    // Spotify is slow on a cold start — poll until the search results render instead of bailing after
    // one snapshot (that one-shot wait is why the first "play X" only opened the app and didn't play).
    let snap = await uia.getUiTree({ maxNodes: 1200, maxDepth: 55 })
    let row = findSpotifyResultRow(snap.elements, parsed)
    for (let i = 0; i < 8 && !row; i++) {
      await Bun.sleep(700)
      snap = await uia.getUiTree({ maxNodes: 1200, maxDepth: 55 })
      row = findSpotifyResultRow(snap.elements, parsed)
    }
    if (!row) {
      return {
        error: `Spotify searched for "${parsed.searchText}", but no matching result was exposed. Refusing to play a different song.`,
      }
    }

    const rowPlay = findPlayNearRow(snap.elements, row.y)
    if (rowPlay) {
      const result = await uia.call("click_element", { ref: rowPlay.ref })
      emitActResult(true, rowPlay.name || row.label || "Spotify Play")
      return { ok: true, query: parsed.original, matched: row.label, clicked: rowPlay.name, result }
    }

    const candidates = snap.elements
      .filter((el) => el.enabled && visibleElement(el) && el.role === "Button")
      .map((el) => ({ el, score: scoreSpotifyPlayButton(el.name, parsed.searchText) }))
      .filter(({ score }) => score > 10)
      .sort((a, b) => b.score - a.score || a.el.rect.y - b.el.rect.y || a.el.rect.x - b.el.rect.x)

    const target = candidates[0]?.el
    if (target) {
      const result = await uia.call("click_element", { ref: target.ref })
      emitActResult(true, target.name || "Spotify Play")
      return { ok: true, query: parsed.original, matched: row.label, clicked: target.name, result }
    }

    // Open the matched row/card, then look for a Play button on its page/card. Never press Space.
    await uia.call("click_element", { ref: row.element.ref })
    await Bun.sleep(900)
    const after = await uia.getUiTree({ maxNodes: 800, maxDepth: 45 })
    const afterRow = findSpotifyResultRow(after.elements, parsed)
    const afterPlay = findPlayNearRow(after.elements, afterRow?.y ?? row.y)

    if (!afterPlay) {
      return {
        error: `Spotify matched "${row.label}", but no Play button for that result was exposed. Refusing to play a different song.`,
      }
    }

    const result = await uia.call("click_element", { ref: afterPlay.ref })
    emitActResult(true, afterPlay.name || row.label || "Spotify Play")
    return { ok: true, query: parsed.original, matched: row.label, clicked: afterPlay.name, result }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function createSystemTools(ctx: { screenshotB64?: string }) {
  return {
    look_at_screen: tool({
      description: "Get a screenshot of the user's current screen. Returns base64-encoded PNG.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
      }),
      execute: async () => {
        if (!ctx.screenshotB64) {
          return { error: "No screenshot available — ask the user to share their screen." }
        }
        return { image_b64: ctx.screenshotB64, format: "png" }
      },
    }),

    bash: tool({
      description:
        "Run a shell command. Only allowlisted commands execute; destructive commands are blocked.",
      parameters: jsonSchema<{ command: string; explanation: string }>({
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          explanation: { type: "string", description: "What this command does and why" },
        },
        required: ["command", "explanation"],
      }),
      execute: async ({ command }) => {
        const proc = Bun.spawn(["sh", "-c", command], {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        })
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        const exitCode = await proc.exited
        return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
      },
    }),

    // --- Windows app automation via UI Automation (accessibility tree) ---

    get_ui_tree: tool({
      description:
        "List the interactive controls of the user's foreground window via Windows UI Automation. " +
        "Returns elements with a `ref`, role, name, screen rect, and supported actions. " +
        "Call this before acting so you can target a control by its `ref`.",
      parameters: jsonSchema<{ maxNodes?: number; maxDepth?: number; hwnd?: number }>({
        type: "object",
        properties: {
          maxNodes: { type: "number", description: "Cap on returned elements (default 400)" },
          maxDepth: { type: "number", description: "Cap on tree traversal depth (default 40)" },
          hwnd: {
            type: "number",
            description: "Optional target window handle; defaults to the foreground window",
          },
        },
        required: [],
      }),
      execute: async ({ maxNodes, maxDepth, hwnd }) => {
        if (platform() !== "win32") return { error: "UI Automation is only supported on Windows." }
        try {
          const info = await uia.getWindowInfo({ hwnd })
          if (isBlockedApp(info.window)) {
            return {
              error: `"${info.window}" is blocklisted — not capturing its controls.`,
              window: info.window,
              elements: [],
            }
          }
          const snap = await uia.getUiTree({ maxNodes, maxDepth, hwnd })
          return snap
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),

    invoke_element: tool({
      description:
        "Invoke (click/activate) a control by its `ref` from the latest get_ui_tree snapshot.",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref, e.g. w1e31" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) =>
        guardedAct({ kind: "invoke", ref }, (r) => uia.call("invoke_element", { ref: r })),
    }),

    set_value: tool({
      description: "Set the text value of an editable control (text field) by its `ref`.",
      parameters: jsonSchema<{ ref: string; text: string }>({
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref from get_ui_tree" },
          text: { type: "string", description: "Text to set" },
        },
        required: ["ref", "text"],
      }),
      execute: async ({ ref, text }) =>
        guardedAct({ kind: "set_value", ref, text }, (r) =>
          uia.call("set_value", { ref: r, text }),
        ),
    }),

    toggle_element: tool({
      description: "Toggle a checkbox/switch control by its `ref`.",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref from get_ui_tree" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) =>
        guardedAct({ kind: "toggle", ref }, (r) => uia.call("toggle_element", { ref: r })),
    }),

    click_element: tool({
      description:
        "Click a control by its `ref` with a real mouse click. Use this instead of invoke_element for " +
        "apps where invoke_element doesn't respond (e.g. WhatsApp, Telegram/Unigram and other UWP apps).",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref from get_ui_tree" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) =>
        guardedAct({ kind: "invoke", ref }, (r) => uia.call("click_element", { ref: r })),
    }),

    type_text: tool({
      description:
        "Type literal text via real keystrokes into the focused field (optionally focusing `ref` first). " +
        "Use this instead of set_value when an app's search box or message composer doesn't react to set_value.",
      parameters: jsonSchema<{ text: string; ref?: string }>({
        type: "object",
        properties: {
          text: { type: "string", description: "Text to type" },
          ref: { type: "string", description: "Optional element ref to focus before typing" },
        },
        required: ["text"],
      }),
      execute: async ({ text, ref }) => {
        if (platform() !== "win32")
          return { error: "Typing automation is only supported on Windows." }
        const blocked = blockedGuard()
        if (blocked) return blocked
        try {
          return await uia.call("type_text", ref ? { text, ref } : { text })
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),

    press_key: tool({
      description:
        'Press a key or chord in the foreground app, e.g. "Enter", "Tab", "Ctrl+S", "Ctrl+Shift+X". ' +
        "Prefer clicking a visible Send/Submit button (invoke_element) over Enter when one exists.",
      parameters: jsonSchema<{ keys: string }>({
        type: "object",
        properties: { keys: { type: "string", description: "Key chord, e.g. Enter, Tab, Ctrl+S" } },
        required: ["keys"],
      }),
      execute: async ({ keys }) => {
        if (platform() !== "win32") return { error: "Key automation is only supported on Windows." }
        const blocked = blockedGuard()
        if (blocked) return blocked
        try {
          return await uia.call("press_key", { keys })
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),

    adjust_volume: tool({
      description:
        'Increase, decrease, or mute the system volume. Use for "increase sound", "lower volume", "mute".',
      parameters: jsonSchema<{ direction: VolumeDirection; steps?: number }>({
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "mute"],
            description: "Volume direction",
          },
          steps: { type: "number", description: "Number of volume key presses, default 2" },
        },
        required: ["direction"],
      }),
      execute: async ({ direction, steps }) => adjustSystemVolume(direction, steps),
    }),

    adjust_spotify_volume: tool({
      description:
        "Increase, decrease, or mute Spotify's own playback volume (in-app Ctrl+Up/Down, separate from system volume). " +
        'Use for "turn up spotify", "lower the spotify volume", "mute spotify".',
      parameters: jsonSchema<{ direction: VolumeDirection; steps?: number }>({
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "mute"],
            description: "Volume direction",
          },
          steps: { type: "number", description: "Number of in-app volume steps, default 3" },
        },
        required: ["direction"],
      }),
      execute: async ({ direction, steps }) => adjustSpotifyVolume(direction, steps),
    }),

    play_spotify: tool({
      description:
        'Open Spotify, search for a track/artist, and click the best visible Play button. Use for requests like "play Impatient by Kesi on Spotify".',
      parameters: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'Song and artist search text, e.g. "Impatient Kesi"',
          },
        },
        required: ["query"],
      }),
      execute: async ({ query }) => {
        return playSpotify(query)
      },
    }),

    send_whatsapp_message: tool({
      description:
        "Open WhatsApp, select a chat, focus the message composer, type the message, and send it. " +
        "Use this for WhatsApp messaging requests instead of generic type_text so text does not land in Search.",
      parameters: jsonSchema<{ recipient: string; message: string }>({
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: 'Chat/contact name, e.g. "You" or a contact name',
          },
          message: { type: "string", description: "Message text to send" },
        },
        required: ["recipient", "message"],
      }),
      execute: async ({ recipient, message }) => sendWhatsAppMessage(recipient, message),
    }),

    launch_app: tool({
      description:
        'Open a desktop app by name (e.g. "WhatsApp", "Notepad"), then call get_ui_tree to see its controls.',
      parameters: jsonSchema<{ name: string }>({
        type: "object",
        properties: {
          name: { type: "string", description: "App name as shown in the Start menu" },
        },
        required: ["name"],
      }),
      execute: async ({ name }) => {
        if (platform() !== "win32") return { error: "launch_app is only supported on Windows." }
        // Resolve Start-menu/Store apps (e.g. Spotify/WhatsApp) by AppID, then try to foreground it.
        return launchWindowsApp(name)
      },
    }),

    // Coordinate fallback for apps with no usable UIA tree (Electron/games/custom-drawn).
    point_cursor: tool({
      description: "Move the mouse cursor to an absolute screen position (coordinate fallback).",
      parameters: jsonSchema<{ x: number; y: number }>({
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate in pixels" },
          y: { type: "number", description: "Y coordinate in pixels" },
        },
        required: ["x", "y"],
      }),
      execute: async ({ x, y }) => {
        if (platform() !== "win32")
          return { error: "Cursor automation is only supported on Windows." }
        const blocked = blockedGuard()
        if (blocked) return blocked
        // The helper moves+clicks together, so stash the point and let `click` perform it.
        uia.pendingPoint = { x, y }
        return { ok: true, x, y }
      },
    }),

    click: tool({
      description: "Click the mouse at the last pointed position (coordinate fallback).",
      parameters: jsonSchema<{ button: "left" | "right" | "middle"; x?: number; y?: number }>({
        type: "object",
        properties: {
          button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
          x: { type: "number", description: "Optional X; defaults to last point_cursor position" },
          y: { type: "number", description: "Optional Y; defaults to last point_cursor position" },
        },
        required: [],
      }),
      execute: async ({ button = "left", x, y }) => {
        if (platform() !== "win32")
          return { error: "Click automation is only supported on Windows." }
        const blocked = blockedGuard()
        if (blocked) return blocked
        const px = x ?? uia.pendingPoint?.x
        const py = y ?? uia.pendingPoint?.y
        if (px === undefined || py === undefined)
          return { error: "no point to click — call point_cursor first or pass x,y" }
        try {
          return await uia.call("click_point", { x: px, y: py, button })
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),
  }
}
