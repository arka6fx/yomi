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

function findWindowsNotepadEditor(elements: UiaElement[]): UiaElement | null {
  const editable = elements.filter(
    (el) =>
      el.enabled &&
      !el.offscreen &&
      (el.patterns.includes("Value") ||
        /^(?:Edit|Document)$/i.test(el.role) ||
        /text editor|notepad/i.test(el.name)),
  )
  return editable.sort(
    (a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
  )[0] ?? null
}

export async function writeWindowsNotepad(
  text: string,
): Promise<{ ok: true; app: "Notepad"; method: string } | { error: string }> {
  if (platform() !== "win32") return { error: "Windows Notepad automation is only supported on Windows." }
  const content = text.trim()
  if (!content) return { error: "No Notepad text provided." }

  const launched = await launchWindowsApp("Notepad", 900)
  if ("error" in launched) return launched

  const snap = await uia.getUiTree({ maxNodes: 300, maxDepth: 30 }).catch(() => null)
  const editor = snap ? findWindowsNotepadEditor(snap.elements) : null
  if (!editor) return { error: "Could not find Notepad's text editor." }

  const setResult = await uia.call("set_value", { ref: editor.ref, text: content }).catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }))
  if (!actFailed(setResult)) return { ok: true, app: "Notepad", method: "set_value" }

  const typed = await uia
    .call("type_text", { ref: editor.ref, text: content })
    .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
  if (actFailed(typed)) return { error: "I opened Notepad, but could not type into it." }
  return { ok: true, app: "Notepad", method: "type_text" }
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

// The topmost Play button in the results area = Spotify's top search result. Used as a fallback when
// the exact title doesn't token-match the query (e.g. "nadaniya" vs the real title "Nadaaniyan"), so
// "play <song>" plays the best match instead of refusing.
function findTopContentPlay(elements: UiaElement[]): UiaElement | undefined {
  const root = elements[0]
  return elements
    .filter(
      (el) =>
        el.enabled &&
        contentElement(el, root) &&
        el.role === "Button" &&
        /\bplay\b/i.test(el.name),
    )
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0]
}

// Click a Spotify play button. First a real UIA click; if that hits the transient COM hiccup
// (0x80040201 EVENT_E_ALL_SUBSCRIBERS_FAILED), fall back to a raw coordinate click at the button's
// center — mouse_event fires no UIA events, so it sidesteps that error entirely.
async function clickSpotify(el: UiaElement): Promise<unknown> {
  try {
    const r = await uia.call("click_element", { ref: el.ref })
    if (!actFailed(r)) return r
  } catch {
    /* fall through to coordinate click */
  }
  await Bun.sleep(150)
  return uia.call("click_point", {
    x: Math.round(el.rect.x + el.rect.width / 2),
    y: Math.round(el.rect.y + el.rect.height / 2),
    button: "left",
  })
}

// --- Background-mode primitives (drive native apps without stealing the user's focus) ---

// Run a real-input flow without stranding the user: capture the window they're in, let `fn`
// foreground the target and act, then restore their prior focus. Best-effort focus-shuttle for apps
// that can't be driven purely through accessibility patterns.
export async function runWithFocusShuttle<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const prior = await uia.getForeground().catch(() => null)
  try {
    return await fn()
  } finally {
    // If we were superseded, don't yank focus back — the new run is taking over.
    if (prior && !signal?.aborted) await uia.setForeground(prior).catch(() => null)
  }
}

export type MediaAction = "play_pause" | "next" | "previous" | "stop"

// Tap a media transport key. Windows routes it to the app owning the media session (Spotify
// registers for it), so this is true background — no window focus needed.
export async function mediaControl(action: MediaAction): Promise<unknown> {
  if (platform() !== "win32") return { error: "Media controls are only supported on Windows." }
  try {
    await uia.mediaKey(action)
    return { ok: true, action }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export type SpotifyControl = "pause" | "resume" | "play_pause" | "next" | "previous" | "stop"

// Background Spotify transport via media keys. pause/resume/play map to the play-pause toggle (a
// media key can't distinguish the two); next/previous/stop are distinct.
export async function controlSpotifyPlayback(action: SpotifyControl): Promise<unknown> {
  const key: MediaAction =
    action === "next" ? "next" : action === "previous" ? "previous" : action === "stop" ? "stop" : "play_pause"
  const res = await mediaControl(key)
  return typeof res === "object" && res !== null && "error" in res
    ? res
    : { ok: true, action, target: "spotify" }
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

// Each "step" of volume change as a fraction of the 0..1 range.
const SPOTIFY_VOLUME_STEP = 0.08

// Spotify volume is controlled through the Windows per-app mixer (Core Audio), NOT Spotify's in-app
// slider: the slider is a WebView2 control whose UIA write yanks Spotify to the foreground, whereas
// the mixer is completely focus-free and invisible. "process" is Spotify's process name.
const SPOTIFY_PROCESS = "Spotify"

export async function adjustSpotifyVolume(
  direction: VolumeDirection,
  steps = 3,
  opts: { background?: boolean; signal?: AbortSignal } = {},
): Promise<unknown> {
  if (platform() !== "win32")
    return { error: "Spotify volume automation is only supported on Windows." }
  if (opts.signal?.aborted) return { error: "superseded" }

  const current = await uia.getAppVolume(SPOTIFY_PROCESS)
  if (current === null)
    return { error: "Spotify isn't playing any audio right now, so there's no volume to change." }

  const delta = SPOTIFY_VOLUME_STEP * Math.max(1, Math.min(steps, 12))
  const target =
    direction === "mute"
      ? 0
      : direction === "up"
        ? Math.min(1, current + delta)
        : Math.max(0, current - delta)

  await uia.setAppVolume(SPOTIFY_PROCESS, target)
  return { ok: true, direction, was: Math.round(current * 100), target: Math.round(target * 100) }
}

// Volume Yomi drops Spotify to while listening, so the playing song doesn't drown out the user's
// voice in the mic. Low but not silent.
const SPOTIFY_DUCK_LEVEL = 0.12
// Volume saved when we duck, restored when listening ends. null = not currently ducked.
let spotifyDuckedFrom: number | null = null

// Duck/restore Spotify via the Windows per-app mixer — focus-free and invisible, so it never steals
// focus from whatever the user is doing. No-op when Spotify isn't producing audio.
export async function duckSpotify(on: boolean): Promise<unknown> {
  if (platform() !== "win32") return { ok: false, reason: "not windows" }
  try {
    if (on) {
      const current = await uia.getAppVolume(SPOTIFY_PROCESS)
      if (current === null) {
        spotifyDuckedFrom = null // nothing playing → nothing to duck
        return { ok: true, spotify: false }
      }
      if (spotifyDuckedFrom === null) spotifyDuckedFrom = current
      if (current <= SPOTIFY_DUCK_LEVEL) return { ok: true, ducked: false, alreadyQuiet: true }
      await uia.setAppVolume(SPOTIFY_PROCESS, SPOTIFY_DUCK_LEVEL)
      return { ok: true, ducked: true, from: Math.round(spotifyDuckedFrom * 100) }
    }

    // Restore the pre-duck volume.
    if (spotifyDuckedFrom === null) return { ok: true, restored: false }
    const restore = spotifyDuckedFrom
    spotifyDuckedFrom = null
    await uia.setAppVolume(SPOTIFY_PROCESS, restore)
    return { ok: true, restored: Math.round(restore * 100) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function normalizeRecipient(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function normalizeSpokenWhatsAppRecipient(text: string): string {
  const trimmed = text.replace(/^\s*(?:my|the|a|an)\s+/i, "").replace(/[.?!,]+$/g, "").trim()
  if (/^(?:me|myself|self|you|message\s*myself|send\s*to\s*myself)$/i.test(trimmed)) return "you"
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return trimmed
  const relation =
    /^(?:mom|mum|mother|mummy|ma|dad|father|papa|brother|sister|wife|husband|partner|friend)$/i
  return relation.test(parts[0] ?? "") ? parts.slice(1).join(" ") : trimmed
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
      // The name (or self) MUST match — otherwise this row is not a candidate at all. The role/size
      // bonuses are only tie-breakers between rows that already matched the name (else any chat row
      // would "match" an unknown name and we'd message the wrong person).
      let nameScore = 0
      if (
        wantsSelf &&
        (name.includes(" you ") ||
          name.endsWith(" you") ||
          name.includes("message yourself") ||
          name.includes("(you)"))
      )
        nameScore += 20
      for (const token of targetTokens) if (token.length >= 2 && name.includes(token)) nameScore += 4
      if (nameScore === 0) return { el, score: 0 }
      let score = nameScore
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

// The Send button sits at the far bottom-right of the composer (appears once there's text). Prefer an
// exact "Send" over "Send document"/"Send feedback", and the right-most/bottom-most candidate.
function findWhatsAppSendButton(elements: UiaElement[]): UiaElement | null {
  const root = elements[0]
  if (!root) return null
  const candidates = elements.filter(
    (el) =>
      el.enabled &&
      visibleElement(el) &&
      el.role === "Button" &&
      /\bsend\b/i.test(el.name) &&
      !/document|photo|file|feedback|sticker|gif/i.test(el.name) &&
      el.rect.x > root.rect.x + root.rect.width * 0.5 &&
      el.rect.y > root.rect.y + root.rect.height * 0.6,
  )
  return (
    candidates.sort(
      (a, b) =>
        (/^send$/i.test(b.name) ? 1 : 0) - (/^send$/i.test(a.name) ? 1 : 0) ||
        b.rect.x - a.rect.x ||
        b.rect.y - a.rect.y,
    )[0] ?? null
  )
}

// True if the WhatsApp composer still holds `text` — i.e. the send didn't go through.
async function whatsAppComposerStillHasText(hwnd: number, text: string): Promise<boolean> {
  const value = await whatsAppComposerText(hwnd)
  return normalizeRecipient(value).includes(normalizeRecipient(text))
}

async function whatsAppComposerText(hwnd: number): Promise<string> {
  const snap = await uia
    .getUiTree({ maxNodes: 1500, maxDepth: 80, hwnd, lite: true })
    .catch(() => ({ window: "", elements: [] as UiaElement[] }))
  const composer = findWhatsAppComposer(snap.elements)
  return composer?.value ?? composer?.name ?? ""
}

async function typeWhatsAppComposer(
  hwnd: number,
  text: string,
  composer: UiaElement | null,
  point: { x: number; y: number } | null,
): Promise<{ ok: boolean; point: { x: number; y: number } | null }> {
  let targetPoint = point
  if (composer) {
    targetPoint = {
      x: Math.round(composer.rect.x + composer.rect.width / 2),
      y: Math.round(composer.rect.y + composer.rect.height / 2),
    }
  }
  if (targetPoint) {
    await uia.call("click_point", { ...targetPoint, button: "left" }).catch(() => null)
    await Bun.sleep(500)
    await uia.call("type_text", { text }).catch(() => null)
  }
  await Bun.sleep(250)
  if (await whatsAppComposerStillHasText(hwnd, text)) return { ok: true, point: targetPoint }

  const snap = await uia.getUiTree({ maxNodes: 1500, maxDepth: 80, hwnd, lite: true }).catch(() => ({
    window: "",
    elements: [] as UiaElement[],
  }))
  const freshComposer = findWhatsAppComposer(snap.elements)
  const freshPoint = freshComposer
    ? {
        x: Math.round(freshComposer.rect.x + freshComposer.rect.width / 2),
        y: Math.round(freshComposer.rect.y + freshComposer.rect.height / 2),
      }
    : composerPoint(snap.elements)
  if (!freshPoint) return { ok: false, point: targetPoint }

  await uia.call("click_point", { ...freshPoint, button: "left" }).catch(() => null)
  await Bun.sleep(200)
  await uia.call("type_text", { text }).catch(() => null)
  await Bun.sleep(250)
  if (await whatsAppComposerStillHasText(hwnd, text)) return { ok: true, point: freshPoint }

  if (freshComposer) {
    await uia.call("set_value", { ref: freshComposer.ref, text }).catch(() => null)
    await Bun.sleep(250)
    if (await whatsAppComposerStillHasText(hwnd, text)) return { ok: true, point: freshPoint }
  }
  return { ok: false, point: freshPoint }
}

async function clearWhatsAppComposer(point: { x: number; y: number } | null): Promise<void> {
  if (point) {
    await uia.call("click_point", { ...point, button: "left" }).catch(() => null)
    await Bun.sleep(150)
  }
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null)
  await Bun.sleep(80)
  await uia.call("press_key", { keys: "Delete" }).catch(() => null)
}

async function openWhatsAppChat(hwnd: number, chat: UiaElement): Promise<boolean> {
  const point = {
    x: Math.round(chat.rect.x + chat.rect.width / 2),
    y: Math.round(chat.rect.y + chat.rect.height / 2),
  }
  await uia.call("click_point", { ...point, button: "left" }).catch(() => null)
  await Bun.sleep(250)
  await uia.call("click_point", { ...point, button: "left" }).catch(() => null)
  for (let i = 0; i < 6; i++) {
    await Bun.sleep(250)
    const snap = await uia
      .getUiTree({ maxNodes: 1500, maxDepth: 80, hwnd, lite: true })
      .catch(() => ({ window: "", elements: [] as UiaElement[] }))
    if (findWhatsAppComposer(snap.elements)) return true
  }
  return false
}

// Resolve WhatsApp's window fast (it's usually already running); only pay the slow launch when it
// has no window (closed or minimized to the tray).
async function resolveWhatsAppWindow(): Promise<number | null> {
  let hwnd =
    (await uia.findWindow({ process: "WhatsApp.Root" })) ??
    (await uia.findWindow({ process: "WhatsApp" })) ??
    (await uia.findWindow({ titleContains: "WhatsApp" }))
  if (hwnd) return hwnd
  const launched = await launchWindowsApp("WhatsApp", 1500)
  if ("error" in launched) return null
  for (let i = 0; i < 12 && !hwnd; i++) {
    await Bun.sleep(400)
    hwnd =
      (await uia.findWindow({ process: "WhatsApp.Root" })) ??
      (await uia.findWindow({ process: "WhatsApp" })) ??
      (await uia.findWindow({ titleContains: "WhatsApp" }))
  }
  return hwnd
}

async function clearWhatsAppField(el: UiaElement | null): Promise<void> {
  if (el) {
    await uia.call("set_value", { ref: el.ref, text: "" }).catch(() => null)
    await Bun.sleep(150)
    await clickElementOrPoint(el)
  }
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null)
  await uia.call("press_key", { keys: "Delete" }).catch(() => null)
  await uia.call("press_key", { keys: "Backspace" }).catch(() => null)
}

// Open the recipient's chat, type the message, send it, then verify the composer cleared.
export async function sendWhatsAppMessage(
  recipient: string,
  message: string,
  opts: { background?: boolean; signal?: AbortSignal } = {},
): Promise<unknown> {
  if (platform() !== "win32") return { error: "WhatsApp automation is only supported on Windows." }
  if (opts.background) {
    const result = await runWithFocusShuttle(
      () => sendWhatsAppMessage(recipient, message, { signal: opts.signal }),
      opts.signal,
    )
    return typeof result === "object" && result !== null && !("error" in result)
      ? { ...result, foregroundedFallback: true }
      : result
  }
  const to = normalizeSpokenWhatsAppRecipient(recipient)
  const text = message.trim()
  if (!to) return { error: "recipient required" }
  if (!text) return { error: "message required" }

  try {
    if (opts.signal?.aborted) return { error: "superseded" }
    const hwnd = await resolveWhatsAppWindow()
    if (!hwnd) return { error: "Could not open WhatsApp." }
    await uia.maximizeWindow(hwnd).catch(() => null) // full window — more reliable + what the user wants
    await uia.setForeground(hwnd).catch(() => null)
    await Bun.sleep(350)

    // WhatsApp's "Message Yourself" chat is labelled "(You)", so for self search "you" — searching
    // "myself" matches any chat whose message preview merely contains that word.
    const isSelf = /^(?:myself|me|self|i|you|message\s*myself|msg\s*myself)$/i.test(to)
    const searchTerm = isSelf ? "you" : to

    // All WhatsApp snapshots use lite mode — the finders only need role/name/rect/enabled/value, and
    // WhatsApp's tree is large enough that the per-node pattern reads otherwise cost seconds each.
    const tree = (maxNodes: number) =>
      uia.getUiTree({ maxNodes, maxDepth: 80, hwnd, lite: true }).catch(() => ({
        window: "",
        elements: [] as UiaElement[],
      }))

    // Search for the contact and open the top matching chat.
    let snap = await tree(800)
    const search = findWhatsAppSearch(snap.elements)
    if (!search) return { error: "Could not find WhatsApp's search box." }
    await clickElementOrPoint(search)
    await Bun.sleep(120)
    await clearWhatsAppField(search)
    await uia.call("type_text", { text: searchTerm })
    await Bun.sleep(550)

    snap = await tree(800)
    // Only act on a confidently name-matched chat. For self that's the "(You)" chat. If we can't find
    // a match, ASK the user instead of guessing/blasting the wrong contact.
    const chat = isSelf
      ? findWhatsAppChat(snap.elements, "you")
      : findWhatsAppChat(snap.elements, to)
    if (!chat) {
      return {
        error: isSelf
          ? "I couldn't find your own (You) chat on WhatsApp."
          : `I couldn't find a WhatsApp chat for "${to}". Who should I message?`,
      }
    }
    const chatName = chat.name || to
    const opened = await openWhatsAppChat(hwnd, chat)
    if (!opened) {
      emitActResult(false, chatName, "chat did not open")
      return { error: `I found ${chatName}, but WhatsApp did not open its message box.` }
    }
    if (opts.signal?.aborted) return { error: "superseded" }

    // Type the message into the composer.
    snap = await tree(1500)
    const composer = findWhatsAppComposer(snap.elements)
    let composerClickPoint: { x: number; y: number } | null = null
    const typed = await typeWhatsAppComposer(hwnd, text, composer, composerPoint(snap.elements))
    composerClickPoint = typed.point
    if (!typed.ok) {
      emitActResult(false, chatName, "typing failed")
      return {
        error: `I opened ${chatName}, but the message text did not land in the WhatsApp message box.`,
      }
    }

    const approved = await requestConfirmation(
      composerClickPoint
        ? { kind: "click_point", ...composerClickPoint, button: "left" }
        : { kind: "click_point", x: 0, y: 0, button: "left" },
      `Send "${text}" to ${chatName}`,
      "sending a message",
    )
    if (!approved) {
      await clearWhatsAppComposer(composerClickPoint)
      emitActResult(false, chatName, "not confirmed")
      return { ok: false, requiresConfirmation: true, label: chatName, reason: "not confirmed" }
    }

    // After confirmation, click the Send button; verify the message left the box and fall back to
    // Enter, then verify again.
    const sendSnap = await tree(1500)
    const sendButton = findWhatsAppSendButton(sendSnap.elements)
    if (sendButton) {
      await uia.call("click_point", {
        x: Math.round(sendButton.rect.x + sendButton.rect.width / 2),
        y: Math.round(sendButton.rect.y + sendButton.rect.height / 2),
        button: "left",
      })
      await Bun.sleep(400)
    }

    // If the button didn't take (or wasn't found), re-focus the composer and press Enter.
    let stillTyped = await whatsAppComposerStillHasText(hwnd, text)
    if (stillTyped) {
      await uia.setForeground(hwnd).catch(() => null)
      if (composerClickPoint)
        await uia.call("click_point", { ...composerClickPoint, button: "left" }).catch(() => null)
      await Bun.sleep(150)
      await uia.call("press_key", { keys: "Enter" })
      await Bun.sleep(400)
      stillTyped = await whatsAppComposerStillHasText(hwnd, text)
    }

    if (stillTyped) {
      emitActResult(false, chatName, "send failed")
      return {
        error: `I typed "${text}" into ${chatName} but couldn't get it to send — it's ready in the box for you to send.`,
      }
    }
    emitActResult(true, `sent to ${chatName}`)
    return { ok: true, recipient: to, chat: chatName, message: text }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function playSpotify(
  query: string,
  opts: { background?: boolean; signal?: AbortSignal } = {},
): Promise<unknown> {
  if (platform() !== "win32") return { error: "Spotify automation is only supported on Windows." }
  const parsed = parseSpotifyQuery(query)
  if (!parsed.searchText) return { error: "spotify search query required" }
  // No true-background route for "play a specific song" (WebView2 + typed search), so focus-shuttle
  // and flag the brief foreground so the pipeline can tell the user.
  if (opts.background) {
    const result = await runWithFocusShuttle(() => playSpotifyForeground(parsed, opts.signal), opts.signal)
    return typeof result === "object" && result !== null && !("error" in result)
      ? { ...result, foregroundedFallback: true }
      : result
  }
  return playSpotifyForeground(parsed, opts.signal)
}

async function playSpotifyForeground(parsed: SpotifyQuery, signal?: AbortSignal): Promise<unknown> {
  try {
    // Fast path when Spotify is already running: foreground it via the helper (~200ms) instead of
    // launchWindowsApp, whose Get-StartApps + AppActivate PowerShell takes ~5s. Match by PROCESS name
    // — when a song is playing the window title is the song, not "Spotify". Cold start still launches.
    let hwnd = await uia.findWindow({ process: "Spotify" })
    if (hwnd) {
      await uia.setForeground(hwnd).catch(() => {})
      await Bun.sleep(150)
    } else {
      const launched = await launchWindowsApp("Spotify", 2200)
      if ("error" in launched) return launched
      hwnd = await uia.findWindow({ process: "Spotify" })
    }

    await uia.call("press_key", { keys: "Ctrl+L" })
    await Bun.sleep(150)
    await uia.call("type_text", { text: parsed.searchText })
    await Bun.sleep(120)
    await uia.call("press_key", { keys: "Enter" })
    await Bun.sleep(500)

    // Poll until the search results render — i.e. any content Play button appears. We do NOT wait for
    // an exact title match: song titles rarely match the spoken query letter-for-letter, and waiting
    // for a token match is what made "play nadaniya" spin for 8 retries and then refuse.
    const emptySnap = { window: "", elements: [] as UiaElement[] }
    // A transient UIA error during one snapshot shouldn't kill the whole flow — default to empty and
    // let the next poll iteration try again.
    const snapshot = () =>
      uia.getUiTree({ maxNodes: 800, maxDepth: 55, hwnd: hwnd ?? undefined }).catch(() => emptySnap)

    let snap = await snapshot()
    let row = findSpotifyResultRow(snap.elements, parsed)
    let topPlay = findTopContentPlay(snap.elements)
    for (let i = 0; i < 8 && !row && !topPlay; i++) {
      if (signal?.aborted) return { error: "superseded" }
      await Bun.sleep(300)
      snap = await snapshot()
      row = findSpotifyResultRow(snap.elements, parsed)
      topPlay = findTopContentPlay(snap.elements)
    }

    // Prefer the Play button next to the best token-matched row; otherwise play the top result.
    const target = (row && findPlayNearRow(snap.elements, row.y)) || topPlay
    if (!target) {
      return {
        error: `Spotify searched for "${parsed.searchText}" but didn't show a playable result.`,
      }
    }

    const result = await clickSpotify(target)
    if (actFailed(result)) return result
    const label = row?.label ?? "top result"
    emitActResult(true, target.name || label || "Spotify Play")
    return { ok: true, query: parsed.original, matched: label, clicked: target.name, result }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function createSystemTools(ctx: { screenshotB64?: string; background?: boolean }) {
  // In background mode, wrap real-input actions in a focus-shuttle so the user's window is restored.
  const shuttle = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.background ? runWithFocusShuttle(fn) : fn()
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
        shuttle(() => guardedAct({ kind: "invoke", ref }, (r) => uia.call("click_element", { ref: r }))),
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
          return await shuttle(() => uia.call("type_text", ref ? { text, ref } : { text }))
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
          return await shuttle(() => uia.call("press_key", { keys }))
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),

    control_spotify: tool({
      description:
        "Control Spotify playback in the background via media keys (no window focus needed). " +
        'Use for "pause/resume/play/stop", "next/skip song", "previous song" — especially when the user says "in the background".',
      parameters: jsonSchema<{ action: SpotifyControl }>({
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["pause", "resume", "play_pause", "next", "previous", "stop"],
            description: "Transport action",
          },
        },
        required: ["action"],
      }),
      execute: async ({ action }) => controlSpotifyPlayback(action),
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
      execute: async ({ direction, steps }) =>
        adjustSpotifyVolume(direction, steps, { background: ctx.background }),
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
        return playSpotify(query, { background: ctx.background })
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
      execute: async ({ recipient, message }) =>
        sendWhatsAppMessage(recipient, message, { background: ctx.background }),
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
          return await shuttle(() => uia.call("click_point", { x: px, y: py, button }))
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),
  }
}
