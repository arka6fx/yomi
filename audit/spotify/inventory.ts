// Spotify Accessibility Inventory — deep scan
// Bun run from apps/sidecar directory
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const UIA_HELPER = "C:\\Users\\arkag\\Projects\\yomi\\apps\\uia-helper\\bin\\Release\\net8.0-windows\\uia-helper.exe"
process.env.YOMI_UIA_HELPER = UIA_HELPER

const { uia } = await import("C:\\Users\\arkag\\Projects\\yomi\\apps\\sidecar\\src\\uia\\client.ts")

const REPORTS = "C:\\Users\\arkag\\Projects\\yomi\\audit\\spotify\\reports"
const CONTROLS_FILE = join(REPORTS, "spotify_controls.json")

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

function findInTree(
  elements: Array<{ role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect: { x: number; y: number; width: number; height: number }; automationId?: string }>,
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

async function main() {
  // Ping helper
  const p = await uia.call<{ ok: boolean }>("ping", {}, 10_000)
  console.log(`Helper ping: ${p?.ok}`)

  // Find Spotify
  const hwnd = await uia.findWindow({ process: "Spotify" }) ?? await uia.findWindow({ titleContains: "Spotify" })
  if (!hwnd) { console.log("Spotify not found"); return }
  console.log(`Spotify hwnd=${hwnd}`)

  await uia.setForeground(hwnd).catch(() => null)
  await sleep(1000)
  await uia.maximizeWindow(hwnd).catch(() => null)
  await sleep(2000)

  // Full tree with lite mode (needed for WebView2 apps like Spotify)
  const snap = await uia.getUiTree({ maxNodes: 1200, maxDepth: 60, hwnd, lite: true })
  console.log(`Tree: window="${snap.window}" elements=${snap.elements.length} truncated=${snap.truncated}`)

  // Log all button names to see what's available
  const allButtons = snap.elements.filter((e: any) => e.role === "Button" && e.name && !e.offscreen)
  console.log(`\nAll visible buttons (${allButtons.length}):`)
  allButtons.forEach((b: any) => console.log(`  "${b.name}" enabled=${b.enabled} rect=${b.rect.x},${b.rect.y}`))

  // Log all Edit fields
  const edits = snap.elements.filter((e: any) => e.role === "Edit" && !e.offscreen)
  console.log(`\nEdit fields (${edits.length}):`)
  edits.forEach((e: any) => console.log(`  "${e.name}"`))

  // Sliders
  const sliders = snap.elements.filter((e: any) => e.role === "Slider" && !e.offscreen)
  console.log(`\nSliders (${sliders.length}):`)
  sliders.forEach((s: any) => console.log(`  "${s.name}"`))

  // Build inventory
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

  controls.searchBar = edits.map((e: any) => ({ ref: e.ref, name: e.name, role: e.role, automationId: e.automationId }))

  controls.libraryPanel = findInTree(snap.elements, {
    role: ["Pane", "Group", "Tree", "List"],
    namePattern: /library/i,
    enabled: true, notOffscreen: true,
  }).map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

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

  controls.volumeControl = findInTree(snap.elements, {
    role: ["Slider", "Button", "Thumb"],
    namePattern: /volume|speaker/i,
    enabled: true, notOffscreen: true,
  }).map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

  controls.queueButton = findInTree(snap.elements, {
    role: "Button",
    namePattern: /queue/i,
    enabled: true, notOffscreen: true,
  }).map((e: any) => ({ ref: e.ref, name: e.name }))

  controls.playlistEntries = findInTree(snap.elements, {
    role: ["ListItem", "DataItem", "Group", "TreeItem"],
    namePattern: /./,
    enabled: true, notOffscreen: true, minWidth: 30,
  }).filter((e: any) => e.name && e.name !== "Your Library" && e.name !== "Library" && e.name !== "Main" && e.name !== "Playlists")
    .slice(0, 50)
    .map((e: any) => ({ ref: e.ref, name: e.name, role: e.role }))

  const summary: Record<string, number> = {}
  for (const [key, val] of Object.entries(controls)) {
    summary[key] = val.length
  }

  console.log(`\nInventory summary: ${JSON.stringify(summary, null, 2)}`)

  await writeFile(CONTROLS_FILE, JSON.stringify(controls, null, 2), "utf8")
  console.log(`\nControls saved to ${CONTROLS_FILE}`)
}

await main().catch(console.error)
