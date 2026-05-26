import { app } from "electron"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

type DesktopSettings = {
  cloudRagEnabled: boolean
}

const DEFAULT_SETTINGS: DesktopSettings = {
  cloudRagEnabled: process.env["YOMI_CLOUD_RAG_ENABLED"] === "true",
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json")
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf-8")
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DesktopSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveDesktopSettings(settings: DesktopSettings): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf-8")
}
