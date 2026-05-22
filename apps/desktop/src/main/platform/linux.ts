import { writeFileSync, existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const WAYBAR_STATE = "/tmp/yomi-waybar.json"
const WAYBAR_CONFIG_DIR = join(homedir(), ".config", "waybar")
const YOMI_FRAGMENT = join(WAYBAR_CONFIG_DIR, "yomi.jsonc")
const MODULE_NAME = "custom/yomi"

export function setupLinux(): void {
  writeWaybar("idle")
  ensureWaybarModule()
}

export function writeWaybar(state: "idle" | "listening" | "processing"): void {
  const icons = { idle: "Y", listening: "🎤", processing: "⏳" }
  writeFileSync(WAYBAR_STATE, JSON.stringify({ text: icons[state], tooltip: `Yomi (${state})` }))
}

function isJsonClean(s: string): boolean {
  try { JSON.parse(s); return true } catch { return false }
}

function injectIntoConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  // Add module definition if missing
  if (!cfg[MODULE_NAME]) {
    cfg[MODULE_NAME] = {
      "exec": "cat /tmp/yomi-waybar.json",
      "return-type": "json",
      "interval": 1,
    }
  }

  // Add module to modules-right if not present in any modules-* list
  for (const key of ["modules-left", "modules-center", "modules-right"]) {
    const list = cfg[key] as string[] | undefined
    if (list && list.includes(MODULE_NAME)) return cfg // already present
  }

  // Append to modules-right
  if (Array.isArray(cfg["modules-right"])) {
    (cfg["modules-right"] as string[]).push(MODULE_NAME)
  }

  return cfg
}

function ensureWaybarModule(): void {
  try {
    if (!existsSync(WAYBAR_CONFIG_DIR)) return

    const configPath = [join(WAYBAR_CONFIG_DIR, "config"), join(WAYBAR_CONFIG_DIR, "config.jsonc")]
      .find(existsSync)
    if (!configPath) return

    const raw = readFileSync(configPath, "utf-8")
    if (raw.includes("yomi-waybar")) return

    // Only auto-patch strict JSON configs
    if (isJsonClean(raw)) {
      const cfg = injectIntoConfig(JSON.parse(raw))
      writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n")
    }
  } catch {
    // non-fatal
  }
}
