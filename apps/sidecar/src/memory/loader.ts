import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const SIDECAR_DATA_DIR = process.platform === "win32"
  ? join(process.env["LOCALAPPDATA"] ?? homedir(), "Yomi", "sidecar")
  : join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "yomi", "sidecar")

export function sidecarDataDir(): string {
  return process.env["YOMI_SIDECAR_DATA_DIR"] ?? process.env["YOMI_NOTEPAD_DIR"] ?? SIDECAR_DATA_DIR
}

export function notepadDir(): string {
  return sidecarDataDir()
}

export async function initMemoryDir(): Promise<void> {
  const root = sidecarDataDir()
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(join(root, "debug"), { recursive: true }),
    mkdir(join(root, "cron"), { recursive: true }),
    mkdir(join(root, "cron", "output"), { recursive: true }),
  ])
}
