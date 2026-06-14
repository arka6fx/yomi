// Desktop Knowledge Graph — stores app→window→control→intent relationships.
// Improves future planning by remembering UI layout across sessions.
// Persists to ~/.yomi/graph/

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ControlNode {
  id: string
  name: string
  role: string
  automationId?: string
  intents: string[] // semantic intents (send, search, close, etc.)
  rect: { x: number; y: number; width: number; height: number }
  lastSeen: number
  seenCount: number
}

export interface WindowNode {
  name: string
  controls: ControlNode[]
  lastSeen: number
}

export interface AppNode {
  name: string
  processName: string
  windows: Map<string, WindowNode> // window title → window
  lastSeen: number
}

interface GraphStore {
  version: 1
  apps: Record<string, { processName: string; windows: Record<string, { controls: ControlNode[]; lastSeen: number }>; lastSeen: number }>
}

const GRAPH_DIR = join(homedir(), ".yomi", "graph")
const GRAPH_FILE = join(GRAPH_DIR, "graph.json")

let store: GraphStore | null = null

async function load(): Promise<GraphStore> {
  if (store) return store
  try { store = JSON.parse(await readFile(GRAPH_FILE, "utf8")) as GraphStore }
  catch { store = { version: 1, apps: {} } }
  return store!
}

async function save(): Promise<void> {
  if (!store) return
  await mkdir(GRAPH_DIR, { recursive: true })
  await writeFile(GRAPH_FILE, JSON.stringify(store, null, 2), "utf8")
}

// Update from a UIA tree snapshot — learn app layout
export async function learnFromTree(
  appName: string, processName: string, windowName: string,
  elements: { ref?: string; role: string; name: string; automationId?: string; enabled?: boolean; offscreen?: boolean; rect: { x: number; y: number; width: number; height: number } }[],
  classifyFn: (role: string, name: string) => { intent: string; confidence: number },
): Promise<void> {
  const g = await load()
  if (!g.apps[appName]) {
    g.apps[appName] = { processName, windows: {}, lastSeen: Date.now() }
  }
  g.apps[appName].lastSeen = Date.now()

  if (!g.apps[appName].windows[windowName]) {
    g.apps[appName].windows[windowName] = { controls: [], lastSeen: Date.now() }
  }
  const win = g.apps[appName].windows[windowName]
  win.lastSeen = Date.now()

  const interactive = elements.filter((e) => e.enabled !== false && !e.offscreen &&
    ["Button", "Edit", "CheckBox", "ComboBox", "MenuItem", "TreeItem", "ListItem", "TabItem", "Hyperlink", "Slider", "RadioButton"].includes(e.role))

  for (const el of interactive) {
    const existing = win.controls.find((c) => c.automationId && c.automationId === el.automationId || c.name === el.name && c.role === el.role)
    if (existing) {
      existing.rect = el.rect
      existing.lastSeen = Date.now()
      existing.seenCount++
      const intent = classifyFn(el.role, el.name)
      if (intent.confidence > 0.5 && !existing.intents.includes(intent.intent)) {
        existing.intents.push(intent.intent)
      }
    } else {
      const intent = classifyFn(el.role, el.name)
      win.controls.push({
        id: el.automationId || `${el.role}_${el.name}_${Date.now()}`,
        name: el.name, role: el.role, automationId: el.automationId,
        intents: intent.confidence > 0.5 ? [intent.intent] : [],
        rect: el.rect, lastSeen: Date.now(), seenCount: 1,
      })
    }
  }

  // Keep only 50 most-recent controls per window
  if (win.controls.length > 50) {
    win.controls.sort((a, b) => b.lastSeen - a.lastSeen)
    win.controls = win.controls.slice(0, 50)
  }

  await save()
}

// Query the graph
export async function findControls(appName: string, intent?: string, role?: string): Promise<ControlNode[]> {
  const g = await load()
  const app = g.apps[appName]
  if (!app) return []

  const results: ControlNode[] = []
  for (const [_, win] of Object.entries(app.windows)) {
    for (const c of win.controls) {
      if (intent && !c.intents.includes(intent)) continue
      if (role && c.role !== role) continue
      results.push(c)
    }
  }
  return results.sort((a, b) => b.seenCount - a.seenCount)
}

export async function getWindowControls(appName: string, windowName: string): Promise<ControlNode[]> {
  const g = await load()
  return g.apps[appName]?.windows[windowName]?.controls ?? []
}

export async function listKnownApps(): Promise<string[]> {
  const g = await load()
  return Object.keys(g.apps)
}
