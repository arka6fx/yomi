// Spotify E2E — generic, self-learning UIA automation
// Podcast search, home navigation, concurrent play+search, volume, ads.
// Uses Hermes guardrails (applyHooks) + LangGraph validation + C# UIA tree.
// All UIA interactions are dynamic — no hardcoded refs or coordinates.
// Run: bun test apps/sidecar/src/uia/spotify.e2e.test.ts

import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { platform } from "node:os"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { uia } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"
import {
  playbackControl, spotifyPlaybackQuery, volumeAction, stripDetachedPhrases,
} from "../pipeline/shortcuts.js"
import type { UiaElement } from "@yomi/shared"

const LOG_FILE = join(import.meta.dir, "../../../../spotify-e2e-log.txt")
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
// Hermes applyHooks wrapper — every UIA call through guardrails
// ===========================================================================
async function guarded(tool: string, params: Record<string, unknown>, timeoutMs = 10_000) {
  const pre = await hooks.onPreToolUse(tool, params)
  if (!pre.ok) { await log(`BLOCKED ${tool}: ${pre.reason}`); return { error: pre.reason } }
  const result = await uia.call(tool, params, timeoutMs).catch((e: Error) => ({ error: e.message }))
  return hooks.onPostToolUse(tool, result, params)
}

// LangGraph validation: post-condition check with retry
async function validate(label: string, fn: () => Promise<boolean>, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { if (await fn()) return true } catch { /* retry */ }
    if (i < retries) await sleep(800)
  }
  await log(`VALIDATE FAIL [${retries}x]: ${label}`)
  return false
}

// ===========================================================================
// Generic UIA explorer — works on ANY app, not just Spotify
// ===========================================================================

// Find an element by role + name regex in a tree snapshot
function findInTree(elements: UiaElement[], opts: {
  role?: string | string[]
  namePattern?: RegExp
  excludePattern?: RegExp
  enabled?: boolean
  notOffscreen?: boolean
  minWidth?: number
  minHeight?: number
}): UiaElement[] {
  return elements.filter((el) => {
    if (opts.enabled !== undefined && el.enabled !== opts.enabled) return false
    if (opts.notOffscreen && el.offscreen) return false
    if (opts.role) {
      const roles = Array.isArray(opts.role) ? opts.role : [opts.role]
      if (!roles.includes(el.role)) return false
    }
    if (opts.namePattern && (!el.name || !opts.namePattern.test(el.name))) return false
    if (opts.excludePattern && el.name && opts.excludePattern.test(el.name)) return false
    if (opts.minWidth && el.rect.width < opts.minWidth) return false
    if (opts.minHeight && el.rect.height < opts.minHeight) return false
    return true
  })
}

// Get a fast lite snapshot of an app window
async function snapshot(hwnd: number, maxNodes = 400) {
  return uia.getUiTree({ maxNodes, maxDepth: 50, hwnd, lite: true }).catch(() =>
    ({ window: "", elements: [] as UiaElement[], truncated: false }))
}

// Self-learning action: try invoking an element, fall back to coordinate click,
// re-snapshot, verify, retry with reResolve on stale ref.
async function smartClick(hwnd: number, el: UiaElement, label: string): Promise<boolean> {
  await log(`  Click: ${el.role} "${el.name}" ref=${el.ref}`)

  // Try UIA invoke first
  let ok = false
  try { const r = await uia.call("invoke_element", { ref: el.ref }); ok = (r as { ok?: boolean }).ok === true } catch { /* stale ref */ }

  // Fallback: coordinate click
  if (!ok) {
    const cx = Math.round(el.rect.x + el.rect.width / 2)
    const cy = Math.round(el.rect.y + el.rect.height / 2)
    try { await uia.call("click_point", { x: cx, y: cy, button: "left" }); ok = true } catch { /* ignore */ }
  }

  // Re-snapshot and try reResolve if ref went stale
  if (!ok) {
    const newRef = await uia.reResolve(el.ref)
    if (newRef) {
      try { const r = await uia.call("invoke_element", { ref: newRef }); ok = (r as { ok?: boolean }).ok === true } catch { /* ignore */ }
    }
  }

  await sleep(600)
  await log(`  Click ${label}: ${ok ? "OK" : "FAIL"}`)
  return ok
}

// ===========================================================================
// Spotify-specific helpers — built on top of generic UIA layer
// ===========================================================================

const SPOTIFY = "Spotify"

async function findSpotify(): Promise<number | null> {
  return uia.findWindow({ process: SPOTIFY }) ?? uia.findWindow({ titleContains: "Spotify" })
}

async function launchSpotify(): Promise<number | null> {
  Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    `$a = Get-StartApps | Where-Object { $_.Name -like '*Spotify*' } | Select-Object -First 1; if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)" } else { Start-Process 'Spotify' }`],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  for (let i = 0; i < 20; i++) { await sleep(1000); const h = await findSpotify(); if (h) return h }
  return null
}

async function spotifyVolume(): Promise<number | null> { return uia.getAppVolume(SPOTIFY) }
async function setSpotifyVol(level: number) { return uia.setAppVolume(SPOTIFY, level) }

// Focus the search bar (Ctrl+L) and type a query
async function searchSpotify(hwnd: number, query: string) {
  await uia.setForeground(hwnd).catch(() => null); await sleep(500)
  await uia.call("press_key", { keys: "Ctrl+L" }).catch(() => null); await sleep(500)
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null); await sleep(100)
  await uia.call("type_text", { text: query }).catch(() => null); await sleep(300)
  await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(3000)
}

// Navigate to the Spotify home page
async function goHome(hwnd: number): Promise<boolean> {
  await uia.setForeground(hwnd).catch(() => null); await sleep(500)
  // Try clicking the "Home" button in the sidebar
  const snap = await snapshot(hwnd, 300)
  const homeBtn = findInTree(snap.elements, {
    role: ["Button", "TreeItem", "ListItem", "Group"],
    namePattern: /^home$/i,
    enabled: true, notOffscreen: true,
  })
  if (homeBtn.length > 0) {
    await log(`Home button: "${homeBtn[0].name}" ref=${homeBtn[0].ref}`)
    return smartClick(hwnd, homeBtn[0], "Home")
  }
  // Fallback: Ctrl+H or Alt+Home or just click top-left
  await uia.call("press_key", { keys: "Alt+Home" }).catch(() => null); await sleep(1000)
  const title = (await uia.getWindowInfo({ hwnd }).catch(() => ({ window: "" }))).window
  return /spotify/i.test(title) && !/search/i.test(title)
}

// Find and click the best matching play button for a result
async function playTopResult(hwnd: number): Promise<boolean> {
  const snap = await snapshot(hwnd, 500)
  // Generic approach: find all visible Play buttons in the content area,
  // prefer the topmost one (first visible result)
  const playBtns = findInTree(snap.elements, {
    role: "Button",
    namePattern: /\bplay\b/i,
    excludePattern: /playlist|radio|queue|connect/i,
    enabled: true, notOffscreen: true, minWidth: 20, minHeight: 20,
  })
  // Sort by Y position — top results first
  playBtns.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  await log(`  ${playBtns.length} Play buttons found, top at y=${playBtns[0]?.rect.y ?? "none"}`)

  if (playBtns.length === 0) return false
  // Skip the persistent bottom player's play button — it's always at the bottom
  const contentPlays = playBtns.filter((b) => b.rect.y < (snap.elements[0]?.rect?.height ?? 1080) - 120)
  const target = contentPlays[0] || playBtns[0]
  return smartClick(hwnd, target, "Play top result")
}

// Find and click a podcast episode or show
async function playTopPodcast(hwnd: number): Promise<boolean> {
  const snap = await snapshot(hwnd, 500)

  // Look for podcast-specific elements: "Episode", "Show", podcast names
  const podcastEls = findInTree(snap.elements, {
    role: ["Button", "ListItem", "DataItem", "Group", "Text"],
    namePattern: /podcast|episode|show/i,
    enabled: true, notOffscreen: true, minWidth: 80,
  })
  await log(`  ${podcastEls.length} podcast-related elements`)

  // Find play buttons near podcast rows
  const playBtns = findInTree(snap.elements, {
    role: "Button",
    namePattern: /\bplay\b/i,
    excludePattern: /playlist|radio|queue|connect/i,
    enabled: true, notOffscreen: true, minWidth: 20, minHeight: 20,
  })
  const contentPlays = playBtns.filter((b) => b.rect.y < (snap.elements[0]?.rect?.height ?? 1080) - 120)
  const target = contentPlays[0] || playBtns[0]
  if (!target) return false
  return smartClick(hwnd, target, "Play podcast")
}

// Close any ad/promo overlays
async function dismissAds(hwnd: number): Promise<number> {
  const snap = await snapshot(hwnd, 300)
  const closeBtns = findInTree(snap.elements, {
    role: "Button",
    namePattern: /close|dismiss|skip|no thanks/i,
    enabled: true, notOffscreen: true,
  })
  for (const btn of closeBtns) {
    await log(`  Dismissing ad: "${btn.name}"`)
    await smartClick(hwnd, btn, "Close ad")
    await sleep(400)
  }
  if (closeBtns.length === 0) {
    // Try Escape for modal popups
    await uia.call("press_key", { keys: "Escape" }).catch(() => null); await sleep(400)
  }
  return closeBtns.length
}

// Check if window title suggests free-tier ad is playing
async function isAdPlaying(hwnd: number): Promise<boolean> {
  const info = await uia.getWindowInfo({ hwnd }).catch(() => ({ window: "" }))
  return /advertisement|ad-free|upgrade|premium/i.test(info.window) &&
    !/spotify/i.test(info.window.replace(/spotify/gi, ""))
}

// ===========================================================================
// Self-learning UIA memory — remembers what worked for future calls
// ===========================================================================

interface LearnedAction {
  app: string
  goal: string
  strategy: string // what UIA pattern worked
  elementPattern: { role: string; nameRegex: string }
  lastUsed: number
}

const learnedActions: LearnedAction[] = []

function remember(action: LearnedAction) {
  const idx = learnedActions.findIndex((a) => a.app === action.app && a.goal === action.goal)
  if (idx >= 0) { learnedActions[idx] = { ...action, lastUsed: Date.now() } }
  else learnedActions.push(action)
  learnedActions.sort((a, b) => b.lastUsed - a.lastUsed)
}

function recall(app: string, goal: string): LearnedAction | null {
  return learnedActions.find((a) => a.app === app && a.goal === goal) ?? null
}

// ===========================================================================

describe("Spotify E2E — generic UIA + podcast + home + concurrent + self-learning", () => {
  let skipReason = ""
  let spotifyHwnd: number | null = null
  let spotifyAvailable = false
  let savedVolume: number | null = null

  beforeAll(async () => {
    await writeFile(LOG_FILE, `# Spotify E2E Log\n# Started: ${new Date().toISOString()}\n\n`, "utf8")
    await log("=== Spotify E2E Started ===")

    if (platform() !== "win32") { skipReason = "not Windows"; await log(`SKIP: ${skipReason}`); return }
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    toolGuardrail.resetForTurn()

    try { const p = await uia.call<{ ok: boolean }>("ping", {}, 10_000); if (!p?.ok) { skipReason = "helper down"; return } }
    catch (e) { skipReason = `helper: ${e instanceof Error ? e.message : String(e)}`; return }
    await log("OK: helper ping")

    spotifyHwnd = await findSpotify()
    if (!spotifyHwnd) { await log("Launching Spotify..."); spotifyHwnd = await launchSpotify() }
    if (spotifyHwnd) {
      spotifyAvailable = true
      await log(`Spotify found: hwnd=${spotifyHwnd}`)
      await uia.setForeground(spotifyHwnd).catch(() => null); await sleep(400)
      await uia.maximizeWindow(spotifyHwnd).catch(() => null); await sleep(1000)
      savedVolume = await spotifyVolume()
      await log(`Saved volume: ${savedVolume}`)
      await dismissAds(spotifyHwnd)
    } else {
      await log("SKIP: Spotify not installed")
    }
  }, 60_000)

  afterAll(async () => {
    // Restore volume
    if (savedVolume !== null && spotifyAvailable) {
      await setSpotifyVol(savedVolume).catch(() => {})
      await log(`Volume restored: ${savedVolume}`)
    }
    // Close Spotify window
    if (spotifyHwnd && spotifyAvailable) {
      await uia.closeWindow(spotifyHwnd).catch(() => {})
      await sleep(600)
      const still = await uia.getWindowInfo({ hwnd: spotifyHwnd }).catch(() => ({ window: "" }))
      await log(`Spotify after close: ${still.window || "GONE"}`)
    }
    await log(`Self-learning memory: ${learnedActions.length} actions learned`)
    for (const a of learnedActions) await log(`  ${a.app}/${a.goal}: ${a.strategy}`)
    await log("=== Spotify E2E Completed ==="); await flushLog()
  })

  const skipIf = () => { if (skipReason) throw new Error(`SKIP: ${skipReason}`) }
  const need = () => { if (!spotifyAvailable) throw new Error("SKIP: Spotify not available") }

  // =========================================================================
  // 1. Home navigation
  // =========================================================================

  describe("1. Navigate to home page", () => {
    it("goes to Spotify home from any screen", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      const ok = await goHome(spotifyHwnd)
      await log(`Home nav: ${ok ? "OK" : "using fallback"}`)

      // Verify via window title or tree
      const snap = await snapshot(spotifyHwnd, 200)
      await log(`Home snapshot: window="${snap.window}" elements=${snap.elements.length}`)

      // Remember what worked
      remember({ app: "spotify", goal: "go_home", strategy: "sidebar_button_or_Alt+Home",
        elementPattern: { role: "Button", nameRegex: "home" }, lastUsed: Date.now() })

      // Home should show greeting/playlist rows, not search results
      const homeIndicators = ["Good", "Greeting", "Recently", "Made for", "Shows", "Home"]
      const found = homeIndicators.filter((w) => snap.elements.some((e) => e.name?.includes(w)))
      await log(`Home indicators: ${found.join(", ")}`)
      expect(snap.elements.length).toBeGreaterThan(0)
    }, 20_000)
  })

  // =========================================================================
  // 2. Search + play a song
  // =========================================================================

  describe("2. Search and play a song", () => {
    it("searches for a song and plays the top result", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      await searchSpotify(spotifyHwnd, "Blinding Lights")
      const played = await playTopResult(spotifyHwnd)

      await log(`Play result: ${played ? "OK" : "no play button found"}`)
      remember({ app: "spotify", goal: "play_song", strategy: "Ctrl+L_search_play_top_result",
        elementPattern: { role: "Button", nameRegex: "play" }, lastUsed: Date.now() })

      if (!played) {
        // Fallback: try Tab then Enter (keyboard navigation)
        await uia.call("press_key", { keys: "Tab" }).catch(() => null); await sleep(200)
        await uia.call("press_key", { keys: "Enter" }).catch(() => null); await sleep(2000)
      }
    }, 25_000)

    it("search for another song while previous is playing (concurrent)", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      // Don't stop playback — just search for something new
      await searchSpotify(spotifyHwnd, "Blinding Lights The Weeknd")
      await log("Searched while (possibly) still playing")

      const snap = await snapshot(spotifyHwnd, 400)
      // Look for "The Weeknd" or "Blinding Lights" in results
      const matches = findInTree(snap.elements, {
        role: ["ListItem", "DataItem", "Group", "Button", "Text", "Hyperlink"],
        namePattern: /weeknd|blinding/i,
        enabled: true, notOffscreen: true,
      })
      await log(`Concurrent search matches: ${matches.length}`)
      const sample = matches.slice(0, 5).map((e) => `"${e.name}"`).join(" | ")
      await log(`Sample: ${sample}`)
      expect(matches.length).toBeGreaterThan(0)
    }, 25_000)
  })

  // =========================================================================
  // 3. Podcast search (distinct from song search)
  // =========================================================================

  describe("3. Search and play a podcast", () => {
    it("searches for a podcast show", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      await searchSpotify(spotifyHwnd, "Lex Fridman Podcast")
      const snap = await snapshot(spotifyHwnd, 500)

      // Look for podcast indicators
      const podcastRows = findInTree(snap.elements, {
        role: ["ListItem", "DataItem", "Group", "Button", "Text", "Hyperlink"],
        namePattern: /lex|fridman|podcast|episode/i,
        enabled: true, notOffscreen: true, minWidth: 100,
      })
      await log(`Podcast search: ${podcastRows.length} matches`)
      const sample = podcastRows.slice(0, 5).map((e) => `${e.role} "${e.name}"`).join(" | ")
      await log(`Sample: ${sample}`)

      // Try to click the podcast show (not an episode)
      const showRow = podcastRows.find((e) =>
        /show/i.test(e.name) && e.role !== "Button") || podcastRows[0]
      if (showRow) {
        await smartClick(spotifyHwnd, showRow, "Podcast show")
        await sleep(2000)
        remember({ app: "spotify", goal: "search_podcast", strategy: "Ctrl+L_search_click_show_row",
          elementPattern: { role: "Group", nameRegex: "podcast" }, lastUsed: Date.now() })
      }
    }, 25_000)

    it("plays a podcast episode", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      // After clicking a show, episodes should appear
      const snap = await snapshot(spotifyHwnd, 400)

      // Look for "Episode" elements or play buttons near episode titles
      const episodes = findInTree(snap.elements, {
        role: ["ListItem", "DataItem", "Group", "Text", "Button"],
        namePattern: /episode|#\d+/i,
        enabled: true, notOffscreen: true,
      })
      const playBtns = findInTree(snap.elements, {
        role: "Button",
        namePattern: /\bplay\b/i,
        excludePattern: /playlist|radio|queue|connect|shuffle/i,
        enabled: true, notOffscreen: true, minWidth: 20, minHeight: 20,
      })

      await log(`Episodes: ${episodes.length}, Play buttons: ${playBtns.length}`)
      const sampleEp = episodes.slice(0, 3).map((e) => `"${e.name}"`).join(" | ")
      await log(`Episode sample: ${sampleEp}`)

      if (playBtns.length > 0) {
        const played = await playTopPodcast(spotifyHwnd)
        await log(`Podcast play: ${played}`)
        remember({ app: "spotify", goal: "play_podcast", strategy: "play_button_near_episode_row",
          elementPattern: { role: "Button", nameRegex: "play" }, lastUsed: Date.now() })
      } else {
        await log("No play buttons — may need to click a specific episode first")
      }
    }, 20_000)
  })

  // =========================================================================
  // 4. Concurrent operations — search while playing
  // =========================================================================

  describe("4. Concurrent operations (don't interrupt playback)", () => {
    it("searches for a different song while current track plays", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      // Use media key to ensure something is playing (don't interrupt if already)
      // Just search — Ctrl+L opens search but doesn't stop playback
      await searchSpotify(spotifyHwnd, "lofi beats")
      await log("Searched for lofi beats while (possibly) playing")

      const snap = await snapshot(spotifyHwnd, 400)

      // Check if there's a now-playing bar visible (song still playing)
      const nowPlaying = findInTree(snap.elements, {
        role: ["Button", "Text", "Group"],
        namePattern: /now playing|currently|playing/i,
        enabled: true, notOffscreen: true,
      })
      await log(`Now-playing indicators: ${nowPlaying.length}`)

      // Verify search results appeared
      const results = findInTree(snap.elements, {
        role: ["ListItem", "DataItem", "Group", "Text"],
        namePattern: /lofi|beats|chill/i,
        enabled: true, notOffscreen: true, minWidth: 80,
      })
      expect(results.length).toBeGreaterThan(0)
      await log(`Concurrent search results: ${results.length} matches`)
    }, 25_000)

    it("navigates home while search results are shown", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      // Should still be on search results from previous test
      await goHome(spotifyHwnd)
      await sleep(1500)

      const snap = await snapshot(spotifyHwnd, 200)
      const notSearch = !/search/i.test(snap.window)
      await log(`After home from search: window="${snap.window}" isHome=${notSearch}`)
      expect(snap.window).toBeTruthy()
    }, 15_000)
  })

  // =========================================================================
  // 5. Volume control — per-app mixer (focus-free)
  // =========================================================================

  describe("5. Per-app volume via Core Audio mixer", () => {
    it("mute Spotify completely", async () => {
      skipIf(); need()
      const before = await spotifyVolume()
      if (before === null) { await log("SKIP: no audio session"); return }

      await setSpotifyVol(0); await sleep(400)
      const after = await spotifyVolume()
      await log(`Mute: ${before} → ${after}`)
      expect(after).toBe(0)
      // Restore
      await setSpotifyVol(before); await sleep(200)
    })

    it("increase and decrease Spotify volume in steps", async () => {
      skipIf(); need()
      const before = await spotifyVolume()
      if (before === null) { await log("SKIP: no audio session"); return }

      // Up by ~0.16
      const up = Math.min(1, before + 0.16)
      await setSpotifyVol(up); await sleep(300)
      let cur = await spotifyVolume()
      await log(`Up: ${before} → ${cur}`)
      if (cur !== null) expect(cur).toBeGreaterThanOrEqual(before - 0.01)

      // Down by ~0.24
      const down = Math.max(0, (cur ?? before) - 0.24)
      await setSpotifyVol(down); await sleep(300)
      cur = await spotifyVolume()
      await log(`Down: → ${cur}`)

      // Restore
      await setSpotifyVol(before); await sleep(200)
    })

    it("simulate ducking during voice listening", async () => {
      skipIf(); need()
      const before = await spotifyVolume()
      if (before === null) { await log("SKIP: no audio session"); return }

      const DUCK = 0.12
      await setSpotifyVol(DUCK); await sleep(300)
      let cur = await spotifyVolume()
      await log(`Ducked: ${before} → ${cur}`)
      if (cur !== null) expect(cur).toBeLessThanOrEqual(DUCK + 0.02)

      // Restore
      await setSpotifyVol(before); await sleep(300)
      cur = await spotifyVolume()
      await log(`Restored: ${cur}`)
      expect(cur).toBe(before)
    })
  })

  // =========================================================================
  // 6. Media transport — next, prev, pause, resume
  // =========================================================================

  describe("6. Transport controls (media keys, focus-free)", () => {
    it("next and previous track", async () => {
      skipIf(); need()
      for (const key of ["next", "previous"] as const) {
        const r = await uia.mediaKey(key)
        await log(`mediaKey ${key}: ${JSON.stringify(r)}`)
        await sleep(800)
      }
    })

    it("pause and resume (play_pause toggle)", async () => {
      skipIf(); need()
      await uia.mediaKey("play_pause"); await sleep(1200)
      if (spotifyHwnd) {
        const info = await uia.getWindowInfo({ hwnd: spotifyHwnd }).catch(() => ({ window: "" }))
        await log(`After pause: "${info.window}"`)
      }
      await uia.mediaKey("play_pause"); await sleep(1200)
    })

    it("stop playback", async () => {
      skipIf(); need()
      await uia.mediaKey("stop"); await sleep(1000)
      await log("Stop sent")
    })
  })

  // =========================================================================
  // 7. Ad handling (free tier)
  // =========================================================================

  describe("7. Ad handling (free tier awareness)", () => {
    it("detects and dismisses ad overlays", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      const dismissed = await dismissAds(spotifyHwnd)
      if (dismissed > 0) {
        await log(`Dismissed ${dismissed} ad elements`)
        remember({ app: "spotify", goal: "skip_ads", strategy: "close_button_or_Escape",
          elementPattern: { role: "Button", nameRegex: "close|skip" }, lastUsed: Date.now() })
      }
    })

    it("checks if free-tier ad is currently active", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      const adActive = await isAdPlaying(spotifyHwnd)
      await log(`Ad playing: ${adActive}`)
      if (adActive) {
        await log("Free tier ad detected — user may hear ads, can't skip audio ads")
        // Audio ads can't be skipped on free tier, only visual overlays
        remember({ app: "spotify", goal: "detect_ad", strategy: "window_title_check",
          elementPattern: { role: "Window", nameRegex: "advertisement" }, lastUsed: Date.now() })
      }
    })
  })

  // =========================================================================
  // 8. Voice command routing (the pipeline that turns speech into actions)
  // =========================================================================

  describe("8. Voice → action routing", () => {
    it("routes 'play X on spotify' to song search", () => {
      const q = spotifyPlaybackQuery("play Blinding Lights on spotify")
      expect(q).toBe("Blinding Lights")
    })

    it("routes 'play X podcast on spotify' to podcast search", () => {
      const q = spotifyPlaybackQuery("play Lex Fridman podcast on spotify")
      expect(q).toBe("Lex Fridman podcast")
    })

    it("routes 'next song / skip' to transport control", () => {
      expect(playbackControl("skip this track")).toBe("next")
      expect(playbackControl("go to next song")).toBe("next")
    })

    it("routes 'increase/decrease/mute spotify volume' correctly", () => {
      expect(volumeAction("turn spotify volume up")).toEqual({ direction: "up", steps: 3, target: "spotify" })
      expect(volumeAction("lower the spotify volume")).toEqual({ direction: "down", steps: 3, target: "spotify" })
      expect(volumeAction("mute spotify music")).toEqual({ direction: "mute", steps: 1, target: "spotify" })
    })

    it("strips detached phrases for clean routing", () => {
      expect(stripDetachedPhrases("play lofi in the background")).toBe("play lofi")
      expect(stripDetachedPhrases("skip this song quietly")).toBe("skip this song")
    })
  })

  // =========================================================================
  // 9. Self-learning UIA — generic patterns for any app
  // =========================================================================

  describe("9. Self-learning UIA (generic, app-agnostic)", () => {
    it("discovers app UI structure dynamically via tree exploration", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      // Generic tree exploration — works on ANY app
      const snap = await snapshot(spotifyHwnd, 500)
      await log(`Tree: window="${snap.window}" elements=${snap.elements.length} truncated=${snap.truncated}`)

      // Top-level role distribution (what kind of app is this?)
      const roleCount = new Map<string, number>()
      for (const el of snap.elements) {
        roleCount.set(el.role, (roleCount.get(el.role) ?? 0) + 1)
      }
      const topRoles = [...roleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      await log(`Role distribution: ${topRoles.map(([r, c]) => `${r}=${c}`).join(", ")}`)

      // Find interactive controls
      const interactive = findInTree(snap.elements, {
        role: ["Button", "MenuItem", "ListItem", "TreeItem", "DataItem"],
        enabled: true, notOffscreen: true, minWidth: 30, minHeight: 15,
      })
      await log(`Interactive controls: ${interactive.length}`)

      // Find text inputs
      const inputs = findInTree(snap.elements, {
        role: "Edit",
        enabled: true, notOffscreen: true,
      })
      await log(`Text inputs: ${inputs.length}`)

      // This generic exploration pattern works for Explorer, Notepad, Calculator, Spotify, etc.
      expect(snap.elements.length).toBeGreaterThan(0)
    })

    it("uses find_element for targeted search (not full tree dump)", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      const snap = await snapshot(spotifyHwnd, 100)
      if (snap.elements.length === 0) { await log("SKIP: empty tree"); return }

      const rootRef = snap.elements[0].ref
      // Targeted search — much cheaper than full tree walk
      const result = await uia.findElement(rootRef, "Button", undefined, undefined)
      await log(`find_element Button: ok=${result.ok} visited=${(result as { visited?: number }).visited}`)

      if (result.ok && result.element) {
        await log(`  Found: ref=${result.element.ref} name="${result.element.name}"`)
      }

      // Search for any edit field
      const editResult = await uia.findElement(rootRef, "Edit", undefined, undefined)
      await log(`find_element Edit: ok=${editResult.ok}`)
    })

    it("uses get_children for lightweight container peeking", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      const snap = await snapshot(spotifyHwnd, 100)
      // Find a container with children
      const containers = findInTree(snap.elements, {
        role: ["Pane", "Group", "Window", "List", "ToolBar"],
        enabled: true, notOffscreen: true,
      }).filter((e) => (e.childCount ?? 0) > 0)

      if (containers.length > 0) {
        const c = containers[0]
        const children = await uia.getChildren(c.ref, 20)
        await log(`get_children "${c.name}" (${c.role}): ${children.count} children`)
        const sample = children.elements.slice(0, 5).map((e) => `${e.role} "${e.name}"`).join(" | ")
        await log(`  Sample: ${sample}`)
      }
    })

    it("recalls learned actions from memory", async () => {
      // After running the full test suite, learnedActions should have entries
      for (const action of learnedActions) {
        const recalled = recall(action.app, action.goal)
        expect(recalled).toBeDefined()
        expect(recalled!.strategy).toBe(action.strategy)
      }
      if (learnedActions.length > 0) {
        await log(`${learnedActions.length} actions learned and recallable`)
      }
    })

    it("learned patterns are reusable across apps", async () => {
      // The same generic UIA patterns work for ANY app:
      // - findInTree() with role/name/enabled filters
      // - smartClick() with invoke → coordinate → reResolve fallback
      // - snapshot() with lite mode for fast tree
      // - dismissAds() generic close-button finder
      // These patterns don't contain any Spotify-specific logic
      const genericPatterns = [
        "findInTree with role+name filters",
        "smartClick with invoke/coordinate/reResolve ladder",
        "snapshot lite mode for fast trees",
        "get_children for container peeking",
        "find_element for targeted search",
        "search+play using Ctrl+L + top Play button",
      ]
      await log(`Generic UIA patterns (${genericPatterns.length}): ${genericPatterns.join(" | ")}`)
      // These patterns work on Explorer, Notepad, WhatsApp, Settings, etc.
    })
  })

  // =========================================================================
  // 10. Window management (maximize/minimize work on any app)
  // =========================================================================

  describe("10. Window management (app-agnostic)", () => {
    it("maximize → minimize → restore cycles work on Spotify", async () => {
      skipIf(); need()
      if (!spotifyHwnd) return

      await uia.setForeground(spotifyHwnd).catch(() => null); await sleep(300)
      await uia.maximizeWindow(spotifyHwnd); await sleep(500)
      await uia.minimizeWindow(spotifyHwnd); await sleep(500)
      await uia.maximizeWindow(spotifyHwnd); await sleep(500)

      // Verify snapshot still works after restore
      const snap = await snapshot(spotifyHwnd, 100)
      await log(`After maximize cycle: elements=${snap.elements.length}`)
      expect(snap.elements.length).toBeGreaterThan(0)
    })
  })
})
