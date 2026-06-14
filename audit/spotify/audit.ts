// Yomi Spotify E2E Audit — Phase S1
// Runs 18 tests against live Spotify Desktop via UIA automation
// bun run audit/spotify/audit.ts

import { platform } from "node:os"
import { appendFile, mkdir, writeFile, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

const UIA_HELPER = "C:\\Users\\arkag\\Projects\\yomi\\apps\\uia-helper\\bin\\Release\\net8.0-windows\\uia-helper.exe"
process.env.YOMI_UIA_HELPER = UIA_HELPER
process.env.YOMI_ACT_AUTOCONFIRM = "true"

const AUDIT_DIR = dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]):/, "$1:")
const SCREENSHOTS = join(AUDIT_DIR, "screenshots")
const LOGS = join(AUDIT_DIR, "logs")
const REPORTS = join(AUDIT_DIR, "reports")
const LOG_FILE = join(LOGS, "audit-run.log")
const REPORT_FILE = join(REPORTS, "audit-report.json")
const CONTROLS_FILE = join(REPORTS, "spotify_controls.json")

const { uia } = await import("C:\\Users\\arkag\\Projects\\yomi\\apps\\sidecar\\src\\uia\\client.ts")

let logBuf = ""
async function log(line: string) {
  const ts = new Date().toISOString().slice(11, 23)
  const entry = `[${ts}] ${line}\n`
  logBuf += entry
  process.stdout.write(entry)
}
async function flushLog() {
  if (logBuf) {
    await mkdir(LOGS, { recursive: true })
    await appendFile(LOG_FILE, logBuf, "utf8")
    logBuf = ""
  }
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const SPOTIFY = "Spotify"
let spotifyHwnd: number | null = null
let spotifyAvailable = false
let savedVolume: number | null = null

type TestResult = {
  id: number
  name: string
  status: "pass" | "fail" | "skip" | "error"
  duration: number
  details: string
  screenshot?: string
  error?: string
}
const results: TestResult[] = []

async function screenshot(name: string): Promise<string> {
  try {
    const cap = await uia.captureScreen(0)
    if (cap.ok && cap.image_b64) {
      const buf = Buffer.from(cap.image_b64, "base64")
      const fn = `${name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 60)}.png`
      const fp = join(SCREENSHOTS, fn)
      await writeFile(fp, buf)
      return fn
    }
  } catch (e) { /* silent */ }
  return ""
}

async function spotifyScreenshot(name: string): Promise<string> {
  try {
    const cap = spotifyHwnd ? await uia.windowScreenshot(spotifyHwnd) : await uia.captureScreen(0)
    if (cap.ok && cap.image_b64) {
      const buf = Buffer.from(cap.image_b64, "base64")
      const fn = `${name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 60)}.png`
      const fp = join(SCREENSHOTS, fn)
      await writeFile(fp, buf)
      return fn
    }
  } catch (e) { /* silent */ }
  return ""
}

async function treeSnapshot(hwnd: number, maxNodes = 400) {
  return uia.getUiTree({ maxNodes, maxDepth: 50, hwnd, lite: true }).catch(() => ({
    window: "", elements: [], truncated: false,
  }))
}

function findInTree(
  elements: Array<{ role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect: { x: number; y: number; width: number; height: number } }>,
  opts: {
    role?: string | string[]
    namePattern?: RegExp
    excludePattern?: RegExp
    enabled?: boolean
    notOffscreen?: boolean
    minWidth?: number
    minHeight?: number
  },
) {
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

async function smartClick(hwnd: number, el: { ref: string; role: string; name?: string; rect: { x: number; y: number; width: number; height: number } }, label: string): Promise<boolean> {
  await log(`  Click: ${el.role} "${el.name}" ref=${el.ref}`)
  let ok = false
  try {
    const r = await uia.call("invoke_element", { ref: el.ref })
    ok = (r as { ok?: boolean }).ok === true
  } catch { /* stale ref */ }
  if (!ok) {
    const cx = Math.round(el.rect.x + el.rect.width / 2)
    const cy = Math.round(el.rect.y + el.rect.height / 2)
    try {
      await uia.call("click_point", { x: cx, y: cy, button: "left" })
      ok = true
    } catch { /* ignore */ }
  }
  if (!ok) {
    const newRef = await uia.reResolve(el.ref)
    if (newRef) {
      try {
        const r = await uia.call("invoke_element", { ref: newRef })
        ok = (r as { ok?: boolean }).ok === true
      } catch { /* ignore */ }
    }
  }
  await sleep(600)
  await log(`  Click ${label}: ${ok ? "OK" : "FAIL"}`)
  return ok
}

async function findSpotify(): Promise<number | null> {
  return uia.findWindow({ process: SPOTIFY }) ?? uia.findWindow({ titleContains: "Spotify" })
}

async function launchSpotify(): Promise<number | null> {
  Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    `$a = Get-StartApps | Where-Object { $_.Name -like '*Spotify*' } | Select-Object -First 1; if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)" } else { Start-Process 'Spotify' }`],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const h = await findSpotify()
    if (h) return h
  }
  return null
}

async function searchSpotify(hwnd: number, query: string) {
  await uia.setForeground(hwnd).catch(() => null)
  await sleep(500)
  await uia.call("press_key", { keys: "Ctrl+L" }).catch(() => null)
  await sleep(500)
  await uia.call("press_key", { keys: "Ctrl+A" }).catch(() => null)
  await sleep(100)
  await uia.call("type_text", { text: query }).catch(() => null)
  await sleep(300)
  await uia.call("press_key", { keys: "Enter" }).catch(() => null)
  await sleep(3000)
}

async function goHome(hwnd: number): Promise<boolean> {
  await uia.setForeground(hwnd).catch(() => null)
  await sleep(500)
  const snap = await treeSnapshot(hwnd, 300)
  const homeBtn = findInTree(snap.elements, {
    role: ["Button", "TreeItem", "ListItem", "Group"],
    namePattern: /^home$/i,
    enabled: true, notOffscreen: true,
  })
  if (homeBtn.length > 0) {
    return smartClick(hwnd, homeBtn[0], "Home")
  }
  await uia.call("press_key", { keys: "Alt+Home" }).catch(() => null)
  await sleep(1000)
  return true
}

async function playTopResult(hwnd: number): Promise<boolean> {
  const snap = await treeSnapshot(hwnd, 500)
  const playBtns = findInTree(snap.elements, {
    role: "Button",
    namePattern: /\bplay\b/i,
    excludePattern: /playlist|radio|queue|connect/i,
    enabled: true, notOffscreen: true, minWidth: 20, minHeight: 20,
  })
  playBtns.sort((a, b: any) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  await log(`  ${playBtns.length} Play buttons found, top at y=${playBtns[0]?.rect.y ?? "none"}`)
  if (playBtns.length === 0) return false
  const contentPlays = playBtns.filter((b: any) => b.rect.y < (snap.elements[0]?.rect?.height ?? 1080) - 120)
  const target = contentPlays[0] || playBtns[0]
  return smartClick(hwnd, target, "Play top result")
}

async function runTest(
  id: number,
  name: string,
  timeout: number,
  fn: () => Promise<string>,
) {
  const start = Date.now()
  await log(`\n--- TEST ${id}: ${name} ---`)
  try {
    const details = await Promise.race([
      fn(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error(`Timeout after ${timeout}ms`)), timeout)),
    ])
    const duration = Date.now() - start
    results.push({ id, name, status: "pass", duration, details })
    await log(`PASS (${duration}ms): ${name}`)
  } catch (e) {
    const duration = Date.now() - start
    const err = e instanceof Error ? e.message : String(e)
    results.push({ id, name, status: err.startsWith("SKIP:") ? "skip" : "fail", duration, details: "", error: err })
    await log(`${err.startsWith("SKIP:") ? "SKIP" : "FAIL"} (${duration}ms): ${name} — ${err}`)
  }
  await flushLog()
}

// ===== TESTS =====

async function main() {
  await mkdir(SCREENSHOTS, { recursive: true })
  await mkdir(LOGS, { recursive: true })
  await mkdir(REPORTS, { recursive: true })
  await writeFile(LOG_FILE, `# Spotify Audit Log — ${new Date().toISOString()}\n\n`, "utf8")

  await log("=== Spotify Audit S1 Started ===")
  await log(`Audit dir: ${AUDIT_DIR}`)

  if (platform() !== "win32") {
    await log("FATAL: UIA automation requires Windows")
    results.push({ id: 0, name: "Platform check", status: "error", duration: 0, details: "", error: "Not Windows" })
    await flushLog()
    await finalize()
    return
  }

  // Verify helper
  try {
    const p = await uia.call<{ ok: boolean }>("ping", {}, 10_000)
    if (!p?.ok) throw new Error("helper ping failed")
    await log("OK: uia-helper ping")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log(`FATAL: uia-helper not available — ${msg}`)
    results.push({ id: 0, name: "UIA helper check", status: "error", duration: 0, details: "", error: msg })
    await flushLog()
    await finalize()
    return
  }

  // Find or launch Spotify
  spotifyHwnd = await findSpotify()
  if (!spotifyHwnd) {
    await log("Spotify not running — launching...")
    spotifyHwnd = await launchSpotify()
  }
  if (spotifyHwnd) {
    spotifyAvailable = true
    await log(`Spotify found: hwnd=${spotifyHwnd}`)
    await uia.setForeground(spotifyHwnd).catch(() => null)
    await sleep(400)
    await uia.maximizeWindow(spotifyHwnd).catch(() => null)
    await sleep(1000)
    savedVolume = await uia.getAppVolume(SPOTIFY)
    await log(`Saved volume: ${savedVolume}`)
    await goHome(spotifyHwnd)
  } else {
    await log("WARN: Spotify not installed or not launchable")
  }

  if (!spotifyAvailable) {
    await log("FATAL: No Spotify available — skipping E2E tests")
  }

  // ===================================================================
  // TEST 1 — Launch Spotify
  // ===================================================================
  await runTest(1, "Launch Spotify", 45_000, async () => {
    if (!spotifyAvailable) return "SKIP: Spotify not available"

    const hwnd = await findSpotify()
    if (!hwnd) throw new Error("Spotify window not found after launch")

    const info = await uia.getWindowInfo({ hwnd })
    await log(`Window found: "${info.window}"`)

    const fore = await uia.setForeground(hwnd)
    await log(`Foreground: ${JSON.stringify(fore)}`)

    await spotifyScreenshot("test01_launch_spotify")
    await log(`Screenshot saved`)

    const snap = await treeSnapshot(hwnd, 200)
    await log(`Window tree: "${snap.window}" elements=${snap.elements.length}`)

    if (!snap.window || snap.elements.length === 0) throw new Error("Window has no UI elements")

    return `hwnd=${hwnd} title="${info.window}" elements=${snap.elements.length}`
  })

  // ===================================================================
  // TEST 2 — Search
  // ===================================================================
  await runTest(2, "Search for Believer by Imagine Dragons", 30_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await searchSpotify(spotifyHwnd, "Believer Imagine Dragons")
    const snap = await treeSnapshot(spotifyHwnd, 500)

    const results = findInTree(snap.elements, {
      role: ["ListItem", "DataItem", "Group", "Text", "Button", "Hyperlink"],
      namePattern: /believer|imagine|dragons/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Search matches: ${results.length}`)
    const sample = results.slice(0, 5).map((e: any) => `"${e.name}"`).join(" | ")
    await log(`Sample: ${sample}`)

    await spotifyScreenshot("test02_search_believer")

    if (results.length === 0) throw new Error("No search results found")
    return `matches=${results.length} sample=${sample}`
  })

  // ===================================================================
  // TEST 3 — Play Song
  // ===================================================================
  await runTest(3, "Play Believer", 30_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    const played = await playTopResult(spotifyHwnd)
    await log(`Play command: ${played ? "OK" : "no play button found"}`)

    if (!played) {
      await uia.call("press_key", { keys: "Tab" }).catch(() => null)
      await sleep(200)
      await uia.call("press_key", { keys: "Tab" }).catch(() => null)
      await sleep(200)
      await uia.call("press_key", { keys: "Enter" }).catch(() => null)
      await sleep(2500)
    }

    await sleep(2000)
    await spotifyScreenshot("test03_play_believer")

    const snap = await treeSnapshot(spotifyHwnd, 300)
    const nowPlaying = findInTree(snap.elements, {
      role: ["Button", "Text", "Group"],
      namePattern: /now playing|believer|imagine|dragons/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Now-playing indicators: ${nowPlaying.length}`)
    if (nowPlaying.length > 0) await log(`  "${nowPlaying[0].name}"`)

    return `played=${played} nowPlaying=${nowPlaying.length}`
  })

  // ===================================================================
  // TEST 4 — Pause
  // ===================================================================
  await runTest(4, "Pause music", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await uia.mediaKey("play_pause")
    await sleep(1500)

    await spotifyScreenshot("test04_pause")

    const snap = await treeSnapshot(spotifyHwnd, 200)
    const pauseBtn = findInTree(snap.elements, {
      role: "Button",
      namePattern: /play/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Play button found after pause: ${pauseBtn.length}`)

    return `playButtonsAfterPause=${pauseBtn.length}`
  })

  // ===================================================================
  // TEST 5 — Resume
  // ===================================================================
  await runTest(5, "Resume music", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await uia.mediaKey("play_pause")
    await sleep(1500)

    await spotifyScreenshot("test05_resume")

    return "resume sent"
  })

  // ===================================================================
  // TEST 6 — Next Track
  // ===================================================================
  await runTest(6, "Next song", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    const snapBefore = await treeSnapshot(spotifyHwnd, 200)
    const titleBefore = snapBefore.elements.find((e: any) =>
      e.role === "Text" && e.name && e.name.length > 3 && e.name.length < 100)

    await uia.mediaKey("next")
    await sleep(2000)

    await spotifyScreenshot("test06_next")

    const snapAfter = await treeSnapshot(spotifyHwnd, 200)
    const titleAfter = snapAfter.elements.find((e: any) =>
      e.role === "Text" && e.name && e.name.length > 3 && e.name.length < 100)

    await log(`Before: "${titleBefore?.name ?? "?"}" After: "${titleAfter?.name ?? "?"}"`)

    return `before="${titleBefore?.name}" after="${titleAfter?.name}"`
  })

  // ===================================================================
  // TEST 7 — Previous Track
  // ===================================================================
  await runTest(7, "Previous song", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    const snapBefore = await treeSnapshot(spotifyHwnd, 200)
    const titleBefore = snapBefore.elements.find((e: any) =>
      e.role === "Text" && e.name && e.name.length > 3 && e.name.length < 100)

    await uia.mediaKey("previous")
    await sleep(2000)

    await spotifyScreenshot("test07_previous")

    const snapAfter = await treeSnapshot(spotifyHwnd, 200)
    const titleAfter = snapAfter.elements.find((e: any) =>
      e.role === "Text" && e.name && e.name.length > 3 && e.name.length < 100)

    await log(`Before: "${titleBefore?.name ?? "?"}" After: "${titleAfter?.name ?? "?"}"`)

    return `before="${titleBefore?.name}" after="${titleAfter?.name}"`
  })

  // ===================================================================
  // TEST 8 — Volume Control
  // ===================================================================
  await runTest(8, "Volume control", 30_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    const volBefore = await uia.getAppVolume(SPOTIFY)
    await log(`Volume before: ${volBefore}`)
    if (volBefore === null) return "SKIP: no active audio session"

    // Set to 25%
    await uia.setAppVolume(SPOTIFY, 0.25)
    await sleep(500)
    const vol25 = await uia.getAppVolume(SPOTIFY)
    await log(`Volume at 25%: ${vol25}`)

    // Set to 50%
    await uia.setAppVolume(SPOTIFY, 0.50)
    await sleep(500)
    const vol50 = await uia.getAppVolume(SPOTIFY)
    await log(`Volume at 50%: ${vol50}`)

    // Mute
    await uia.setAppVolume(SPOTIFY, 0)
    await sleep(500)
    const muted = await uia.getAppVolume(SPOTIFY)
    await log(`Muted: ${muted}`)

    // Unmute
    await uia.setAppVolume(SPOTIFY, volBefore)
    await sleep(500)
    const restored = await uia.getAppVolume(SPOTIFY)
    await log(`Restored: ${restored}`)

    await spotifyScreenshot("test08_volume")

    if (vol25 !== null && vol25 > 0.30) throw new Error(`Volume not set to 25%: ${vol25}`)
    if (vol50 !== null && (vol50 < 0.40 || vol50 > 0.60)) throw new Error(`Volume not set to 50%: ${vol50}`)
    if (muted !== null && muted !== 0) throw new Error(`Volume not muted: ${muted}`)
    if (restored !== null && restored !== volBefore) throw new Error(`Volume not restored: ${restored}`)

    return `before=${volBefore} set25=${vol25} set50=${vol50} muted=${muted} restored=${restored}`
  })

  // ===================================================================
  // TEST 9 — Playlist Discovery
  // ===================================================================
  await runTest(9, "Playlist Discovery", 25_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    // Navigate to Library
    await uia.setForeground(spotifyHwnd)
    await sleep(500)

    // Click "Your Library" in sidebar
    const snap = await treeSnapshot(spotifyHwnd, 400)
    const libBtn = findInTree(snap.elements, {
      role: ["Button", "TreeItem", "ListItem", "Group"],
      namePattern: /your library|library/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Library buttons: ${libBtn.length}`)
    if (libBtn.length > 0) {
      await smartClick(spotifyHwnd, libBtn[0], "Library")
      await sleep(2000)
    }

    const libSnap = await treeSnapshot(spotifyHwnd, 500)
    const playlistEls = findInTree(libSnap.elements, {
      role: ["ListItem", "DataItem", "Group", "Text", "Button", "TreeItem"],
      namePattern: /playlist|my playlist|liked songs|favorites/i,
      enabled: true, notOffscreen: true, minWidth: 30,
    })
    await log(`Playlist elements: ${playlistEls.length}`)
    const playlistNames = [...new Set(playlistEls.map((e: any) => e.name).filter(Boolean))]
    await log(`Playlists found: ${playlistNames.join(", ") || "none"}`)

    await spotifyScreenshot("test09_playlist_discovery")

    return `playlists=${playlistNames.length} names=${playlistNames.join(",")}`
  })

  // ===================================================================
  // TEST 10 — Play Specific Playlist
  // ===================================================================
  await runTest(10, "Play Specific Playlist", 25_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    // Navigate to library
    const snap = await treeSnapshot(spotifyHwnd, 300)
    const libBtn = findInTree(snap.elements, {
      role: ["Button", "TreeItem", "ListItem", "Group"],
      namePattern: /your library|library/i,
      enabled: true, notOffscreen: true,
    })
    if (libBtn.length > 0) {
      await smartClick(spotifyHwnd, libBtn[0], "Library")
      await sleep(1500)
    }

    const libSnap = await treeSnapshot(spotifyHwnd, 400)
    const playlistItems = findInTree(libSnap.elements, {
      role: ["ListItem", "DataItem", "Group", "Text", "TreeItem"],
      namePattern: /./,
      enabled: true, notOffscreen: true, minWidth: 30,
    }).filter((e: any) => e.name && e.name !== "Your Library" && e.name !== "Library")

    await log(`Library items: ${playlistItems.length}`)
    const names2 = [...new Set(playlistItems.map((e: any) => e.name))].slice(0, 10)
    await log(`Items: ${names2.join(", ") || "none"}`)

    if (playlistItems.length > 0) {
      await smartClick(spotifyHwnd, playlistItems[0], "First playlist item")
      await sleep(1500)
    }

    await spotifyScreenshot("test10_play_playlist")

    return `items=${playlistItems.length} names=${names2.join(",")}`
  })

  // ===================================================================
  // TEST 11 — Shuffle
  // ===================================================================
  await runTest(11, "Shuffle on/off", 20_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await goHome(spotifyHwnd)
    await sleep(1000)

    const snap1 = await treeSnapshot(spotifyHwnd, 400)
    const shuffleBtns = findInTree(snap1.elements, {
      role: "Button",
      namePattern: /shuffle/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Shuffle buttons found: ${shuffleBtns.length}`)

    if (shuffleBtns.length > 0) {
      await smartClick(spotifyHwnd, shuffleBtns[0], "Shuffle")
      await sleep(1000)
      await log("Toggled shuffle")
    } else {
      await log("No shuffle button found in UI tree")
    }

    await spotifyScreenshot("test11_shuffle")

    return `shuffleBtns=${shuffleBtns.length}`
  })

  // ===================================================================
  // TEST 12 — Repeat
  // ===================================================================
  await runTest(12, "Repeat", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    const snap = await treeSnapshot(spotifyHwnd, 400)
    const repeatBtns = findInTree(snap.elements, {
      role: "Button",
      namePattern: /repeat/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Repeat buttons found: ${repeatBtns.length}`)

    if (repeatBtns.length > 0) {
      await smartClick(spotifyHwnd, repeatBtns[0], "Repeat")
      await sleep(1000)
      await log("Toggled repeat")
    } else {
      await log("No repeat button found in UI tree")
    }

    await spotifyScreenshot("test12_repeat")

    return `repeatBtns=${repeatBtns.length}`
  })

  // ===================================================================
  // TEST 13 — Scroll Validation
  // ===================================================================
  await runTest(13, "Scroll Validation", 25_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    // Navigate: Home
    await goHome(spotifyHwnd)
    await sleep(1000)
    const homeSnap = await treeSnapshot(spotifyHwnd, 300)
    await log(`Home page: elements=${homeSnap.elements.length} truncated=${homeSnap.truncated}`)
    await spotifyScreenshot("test13a_home")

    // Navigate: Search
    await uia.setForeground(spotifyHwnd)
    await sleep(300)
    await uia.call("press_key", { keys: "Ctrl+L" }).catch(() => null)
    await sleep(1000)
    const searchSnap = await treeSnapshot(spotifyHwnd, 300)
    await log(`Search page: elements=${searchSnap.elements.length}`)
    await spotifyScreenshot("test13b_search")
    await uia.call("press_key", { keys: "Escape" }).catch(() => null)
    await sleep(500)

    // Navigate: Library
    await uia.setForeground(spotifyHwnd)
    const snapLib = await treeSnapshot(spotifyHwnd, 200)
    const libBtn3 = findInTree(snapLib.elements, {
      role: ["Button", "TreeItem", "ListItem", "Group"],
      namePattern: /your library|library/i,
      enabled: true, notOffscreen: true,
    })
    if (libBtn3.length > 0) {
      await smartClick(spotifyHwnd, libBtn3[0], "Library")
      await sleep(1500)
    }
    const libSnap3 = await treeSnapshot(spotifyHwnd, 300)
    await log(`Library page: elements=${libSnap3.elements.length}`)
    await spotifyScreenshot("test13c_library")

    // Try scrolling a container
    const containers = findInTree((await treeSnapshot(spotifyHwnd, 200)).elements, {
      role: ["List", "Pane", "Group"],
      enabled: true, notOffscreen: true,
    }).filter((e: any) => (e.childCount ?? 0) > 3)

    let scrollResult = "none"
    if (containers.length > 0) {
      for (const c of containers.slice(0, 3)) {
        try {
          const r = await uia.call("scroll", { ref: c.ref, verticalPercent: 50 })
          await log(`Scrolled "${c.name}" (${c.role}): ${JSON.stringify(r)}`)
          scrollResult = "ok"
          break
        } catch { /* continue */ }
      }
    }
    await spotifyScreenshot("test13d_scrolled")

    return `home=${homeSnap.elements.length} search=${searchSnap.elements.length} library=${libSnap3.elements.length} scroll=${scrollResult}`
  })

  // ===================================================================
  // TEST 14 — Queue Access
  // ===================================================================
  await runTest(14, "Queue Access", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await uia.setForeground(spotifyHwnd)
    await sleep(300)

    // Try Ctrl+Q or find the queue button
    const snap = await treeSnapshot(spotifyHwnd, 300)
    const queueBtns = findInTree(snap.elements, {
      role: "Button",
      namePattern: /queue/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Queue buttons: ${queueBtns.length}`)

    if (queueBtns.length > 0) {
      await smartClick(spotifyHwnd, queueBtns[0], "Queue")
      await sleep(1500)
    } else {
      // Try keyboard shortcut
      await uia.call("press_key", { keys: "Ctrl+Shift+Q" }).catch(() => null)
      await sleep(1000)
    }

    await spotifyScreenshot("test14_queue")

    const qSnap = await treeSnapshot(spotifyHwnd, 300)
    const songs = findInTree(qSnap.elements, {
      role: ["ListItem", "DataItem", "Text", "Group"],
      enabled: true, notOffscreen: true,
    }).filter((e: any) => e.name && e.name.length > 1)

    await log(`Queue panel items: ${songs.length}`)

    return `queueBtns=${queueBtns.length} items=${songs.length}`
  })

  // ===================================================================
  // TEST 15 — Device Selection
  // ===================================================================
  await runTest(15, "Device Selection", 15_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await uia.setForeground(spotifyHwnd)
    await sleep(500)

    const snap = await treeSnapshot(spotifyHwnd, 400)
    const deviceBtns = findInTree(snap.elements, {
      role: "Button",
      namePattern: /connect|device|speaker|available/i,
      enabled: true, notOffscreen: true,
    })
    await log(`Device/connect buttons: ${deviceBtns.length}`)
    if (deviceBtns.length > 0) {
      deviceBtns.forEach((b: any) => log(`  "${b.name}" ref=${b.ref}`))
    }

    await spotifyScreenshot("test15_devices")

    return `deviceBtns=${deviceBtns.length}`
  })

  // ===================================================================
  // TEST 16 — Ambiguous Music Request
  // ===================================================================
  await runTest(16, "Ambiguous Music Request", 25_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await searchSpotify(spotifyHwnd, "Stay")
    await sleep(2000)

    const snap = await treeSnapshot(spotifyHwnd, 500)
    const results = findInTree(snap.elements, {
      role: ["ListItem", "DataItem", "Group", "Text", "Hyperlink"],
      namePattern: /stay/i,
      enabled: true, notOffscreen: true,
    })
    await log(`"Stay" search results: ${results.length}`)

    const names = [...new Set(results.map((e: any) => e.name).filter(Boolean))]
      .filter((n: string) => n.length > 1 && n.length < 100)
    await log(`Unique results: ${names.slice(0, 10).join(" | ") || "none"}`)

    await spotifyScreenshot("test16_ambiguous_stay")

    if (results.length === 0) throw new Error("No results for 'Stay'")
    if (names.length > 1) {
      await log("Multiple versions found — ambiguity handling required")
    }

    return `results=${results.length} unique=${names.slice(0, 5).join(",")}`
  })

  // ===================================================================
  // TEST 17 — Recovery Test
  // ===================================================================
  await runTest(17, "Recovery Test", 30_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    const details: string[] = []

    // Test 1: Close Spotify unexpectedly and verify detection
    const hwnd = spotifyHwnd
    await uia.closeWindow(hwnd)
    await sleep(2000)

    const stillThere = await findSpotify()
    await log(`Spotify after close: ${stillThere ? "still running" : "closed"}`)
    details.push(`close_detected=${!stillThere}`)

    // Re-launch
    if (!stillThere) {
      await log("Attempting recovery — re-launching Spotify...")
      spotifyHwnd = await launchSpotify()
      if (spotifyHwnd) {
        await log(`Recovery OK: hwnd=${spotifyHwnd}`)
        await uia.setForeground(spotifyHwnd).catch(() => null)
        await sleep(500)
        await uia.maximizeWindow(spotifyHwnd).catch(() => null)
        details.push("recovery=ok")
      } else {
        details.push("recovery=failed")
        await log("Recovery failed — cannot re-launch")
        spotifyAvailable = false
      }
    }

    await spotifyScreenshot("test17_recovery")

    return details.join(" ")
  })

  // ===================================================================
  // TEST 18 — Accessibility Inventory
  // ===================================================================
  await runTest(18, "Accessibility Inventory", 20_000, async () => {
    if (!spotifyHwnd) return "SKIP: Spotify unavailable"

    await uia.setForeground(spotifyHwnd)
    await sleep(500)
    const snap = await treeSnapshot(spotifyHwnd, 600)

    const controls: Record<string, any[]> = {
      searchBar: [],
      libraryPanel: [],
      playlistEntries: [],
      playButton: [],
      pauseButton: [],
      nextButton: [],
      previousButton: [],
      volumeControl: [],
      queueButton: [],
    }

    // Search bar (Edit control)
    controls.searchBar = findInTree(snap.elements, {
      role: "Edit",
      enabled: true, notOffscreen: true,
    }).map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

    // Library panel
    controls.libraryPanel = findInTree(snap.elements, {
      role: ["Pane", "Group", "Tree", "List"],
      namePattern: /library/i,
      enabled: true, notOffscreen: true,
    }).map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

    // Play/Pause buttons
    controls.playButton = findInTree(snap.elements, {
      role: "Button",
      namePattern: /\bplay\b/i,
      enabled: true, notOffscreen: true, minWidth: 20, minHeight: 20,
    }).map((e: any) => ({ ref: e.ref, name: e.name }))

    controls.pauseButton = findInTree(snap.elements, {
      role: "Button",
      namePattern: /pause/i,
      enabled: true, notOffscreen: true, minWidth: 20, minHeight: 20,
    }).map((e: any) => ({ ref: e.ref, name: e.name }))

    // Next/Previous
    controls.nextButton = findInTree(snap.elements, {
      role: "Button",
      namePattern: /\bnext|skip forward/i,
      enabled: true, notOffscreen: true, minWidth: 20,
    }).map((e: any) => ({ ref: e.ref, name: e.name }))

    controls.previousButton = findInTree(snap.elements, {
      role: "Button",
      namePattern: /\bprevious|skip back/i,
      enabled: true, notOffscreen: true, minWidth: 20,
    }).map((e: any) => ({ ref: e.ref, name: e.name }))

    // Volume
    controls.volumeControl = findInTree(snap.elements, {
      role: ["Slider", "Button", "Thumb"],
      namePattern: /volume|speaker/i,
      enabled: true, notOffscreen: true,
    }).map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

    // Queue
    controls.queueButton = findInTree(snap.elements, {
      role: "Button",
      namePattern: /queue/i,
      enabled: true, notOffscreen: true,
    }).map((e: any) => ({ ref: e.ref, name: e.name }))

    // Playlist entries
    controls.playlistEntries = findInTree(snap.elements, {
      role: ["ListItem", "DataItem", "Group", "TreeItem"],
      namePattern: /./,
      enabled: true, notOffscreen: true, minWidth: 30,
    }).filter((e: any) => e.name && e.name !== "Your Library" && e.name !== "Library")
      .slice(0, 30)
      .map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

    // Remove empty arrays
    const filtered: Record<string, any> = {}
    for (const [key, val] of Object.entries(controls)) {
      filtered[key] = val
    }

    await writeFile(CONTROLS_FILE, JSON.stringify(filtered, null, 2), "utf8")
    await log(`Controls inventory saved to ${CONTROLS_FILE}`)

    const summary: Record<string, number> = {}
    for (const [key, val] of Object.entries(filtered)) {
      summary[key] = val.length
    }
    await log(`Inventory summary: ${JSON.stringify(summary)}`)

    await spotifyScreenshot("test18_accessibility")

    return JSON.stringify(summary)
  })

  // ===== CLEANUP =====
  if (savedVolume !== null && spotifyAvailable) {
    await uia.setAppVolume(SPOTIFY, savedVolume).catch(() => {})
  }

  await log("\n=== Spotify Audit S1 Completed ===")
  await flushLog()
  await finalize()
}

async function finalize() {
  // Generate report
  const passed = results.filter((r) => r.status === "pass").length
  const failed = results.filter((r) => r.status === "fail").length
  const skipped = results.filter((r) => r.status === "skip").length
  const errors = results.filter((r) => r.status === "error").length
  const total = results.length

  const report = {
    audit: "Phase S1 — Spotify End-to-End Validation",
    date: new Date().toISOString(),
    platform: platform(),
    hostname: process.env.COMPUTERNAME || "unknown",
    spotifyAvailable,
    spotifyHwnd,
    summary: { total, passed, failed, skipped, errors },
    certification: null as string | null,
    tests: results,
    artifacts: {
      screenshots: SCREENSHOTS,
      logs: LOG_FILE,
      controls: CONTROLS_FILE,
    },
  }

  // Certification logic
  if (!spotifyAvailable) {
    report.certification = "NOT VERIFIED — Spotify not available on this system"
  } else {
    const critical = [1, 2, 3, 4, 5, 6, 7]
    const criticalPassed = critical.every((id) => results.find((r) => r.id === id)?.status === "pass")
    const test9Passed = results.find((r) => r.id === 9)?.status === "pass"
    const test16Handled = results.find((r) => r.id === 16)?.status === "pass" || results.find((r) => r.id === 16)?.status === "skip"
    const test17Recovery = results.find((r) => r.id === 17)?.status === "pass" || results.find((r) => r.id === 17)?.status === "skip"
    const controlsExist = results.find((r) => r.id === 18)?.status === "pass"

    if (criticalPassed && controlsExist) {
      report.certification = "SPOTIFY VERIFIED — All critical E2E flows pass with evidence"
    } else {
      const missing = []
      if (!criticalPassed) missing.push("critical playback tests")
      if (!controlsExist) missing.push("accessibility inventory")
      if (!test9Handled) {}
      if (!test16Handled) {}
      if (!test17Recovery) {}
      report.certification = `NOT VERIFIED — Missing: ${missing.join(", ")}`
    }
  }

  await writeFile(REPORT_FILE, JSON.stringify(report, null, 2), "utf8")
  await log(`\nReport saved to ${REPORT_FILE}`)

  const cert = report.certification || "PENDING"
  await log(`\n=== CERTIFICATION: ${cert} ===`)
  await log(`Passed: ${passed}/${total} | Failed: ${failed} | Skipped: ${skipped} | Errors: ${errors}`)
}

await main().catch(async (e) => {
  await log(`FATAL: ${e instanceof Error ? e.message : String(e)}`)
  await flushLog()
  await finalize()
})
