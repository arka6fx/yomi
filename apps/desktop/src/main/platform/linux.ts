import { writeFileSync } from "node:fs"

const WAYBAR_JSON = "/tmp/yomi-waybar.json"

export function setupLinux(): void {
  writeWaybar("idle")
}

export function writeWaybar(state: "idle" | "listening" | "processing"): void {
  const icons = { idle: "", listening: "󰍬", processing: "󰀚" }
  writeFileSync(WAYBAR_JSON, JSON.stringify({ text: icons[state], tooltip: `Yomi (${state})` }))
}
