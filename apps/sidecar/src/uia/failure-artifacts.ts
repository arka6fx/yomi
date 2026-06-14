import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { UiaAction, UiaSnapshot } from "@yomi/shared"
import type { RecoveryResult } from "./recovery.js"
import { uia } from "./client.js"
import { notepadDir } from "../memory/loader.js"
import { captureScreen as captureScreenFromVision } from "./vision-layer.js"

type ActAttempt = {
  attempt: number
  ref: string
  stale: boolean
  error: string
}

class UiaRpcError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = "UiaRpcError"
    this.code = code
  }
}

export type FailureArtifactInput = {
  runId: string
  action: UiaAction | { kind: string; ref?: string }
  error: unknown
  attempts?: ActAttempt[]
  recovery?: RecoveryResult
  snapshot?: UiaSnapshot | null
  focusTree?: unknown
  screenshotB64?: string
}

export type FailureArtifact = {
  dir: string
  manifestPath: string
  files: string[]
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run"
}

export function automationArtifactRoot(): string {
  return join(notepadDir(), "debug")
}

export async function createAutomationArtifactDir(runId: string): Promise<string> {
  const dir = join(automationArtifactRoot(), `${safeSegment(runId)}-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  return dir
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof UiaRpcError) return { name: error.name, message: error.message, code: error.code }
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  if (typeof error === "object" && error !== null) return { ...(error as Record<string, unknown>) }
  return { message: String(error) }
}

async function writeJson(dir: string, name: string, value: unknown, files: string[]): Promise<void> {
  const path = join(dir, name)
  await writeFile(path, JSON.stringify(value, null, 2), "utf8")
  files.push(path)
}

export async function writeFailureArtifact(input: FailureArtifactInput): Promise<FailureArtifact> {
  const dir = await createAutomationArtifactDir(input.runId)
  const files: string[] = []
  const snapshot = input.snapshot ?? await uia.getUiTree().catch(() => null)
  const focusTree = input.focusTree ?? await uia.getFocusTree(5).catch(() => null)
  const screenshot = input.screenshotB64 ?? (await captureScreenFromVision().catch(() => null))?.image_b64

  await writeJson(dir, "action.json", input.action, files)
  await writeJson(dir, "error.json", serializeError(input.error), files)
  await writeJson(dir, "attempts.json", input.attempts ?? [], files)
  await writeJson(dir, "recovery.json", input.recovery ?? null, files)
  await writeJson(dir, "uia-snapshot.json", snapshot, files)
  await writeJson(dir, "focus-tree.json", focusTree, files)
  if (screenshot) {
    const screenshotPath = join(dir, "screenshot.b64.txt")
    await writeFile(screenshotPath, screenshot, "utf8")
    files.push(screenshotPath)
  }

  const manifest = {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    action: input.action,
    error: serializeError(input.error),
    files: files.map((file) => file.slice(dir.length + 1)),
  }
  const manifestPath = join(dir, "manifest.json")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  files.push(manifestPath)
  return { dir, manifestPath, files }
}
