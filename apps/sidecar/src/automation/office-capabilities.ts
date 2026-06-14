import { existsSync, statSync } from "node:fs"
import { basename } from "node:path"
import type { CapabilityTest, Evidence } from "./capability-validation.js"

export type OfficeApp = "word" | "excel" | "powerpoint" | "onenote" | "outlook"

export type OfficeCapabilityOptions = {
  app: OfficeApp
  filePath: string
  launch?: (filePath: string) => Promise<unknown>
  edit?: (filePath: string) => Promise<unknown>
  read?: (filePath: string) => Promise<string | Buffer>
  windowProbe?: (titlePart: string) => Promise<boolean>
}

const extensions: Record<OfficeApp, string[]> = {
  word: [".docx", ".doc"],
  excel: [".xlsx", ".xls"],
  powerpoint: [".pptx", ".ppt"],
  onenote: [".one"],
  outlook: [".msg", ".eml"],
}

export function officeCapabilityName(app: OfficeApp, action: string): string {
  return `office.${app}.${action}`
}

export function validateOfficeFileEvidence(app: OfficeApp, filePath: string, content?: string | Buffer): Evidence[] {
  const extOk = extensions[app].some((ext) => filePath.toLowerCase().endsWith(ext))
  const exists = existsSync(filePath)
  const size = exists ? statSync(filePath).size : 0
  const readable = content === undefined ? exists && size > 0 : Buffer.byteLength(content) > 0
  return [
    { kind: "filesystem", label: "expected Office file exists", passed: exists, detail: filePath },
    { kind: "filesystem", label: "Office file extension matches app", passed: extOk, detail: basename(filePath) },
    { kind: "filesystem", label: "Office file is non-empty", passed: size > 0, detail: `${size} bytes` },
    { kind: "filesystem", label: "Office file is readable", passed: readable },
  ]
}

export function createOfficeOpenEditCapability(options: OfficeCapabilityOptions): CapabilityTest {
  return {
    capability: officeCapabilityName(options.app, "open_edit_save_reopen"),
    category: "office",
    execute: async () => {
      const launchResult = options.launch ? await options.launch(options.filePath) : null
      const editResult = options.edit ? await options.edit(options.filePath) : null
      return { launchResult, editResult }
    },
    validate: async () => {
      const content = options.read ? await options.read(options.filePath) : undefined
      const evidence = validateOfficeFileEvidence(options.app, options.filePath, content)
      if (options.windowProbe) {
        const visible = await options.windowProbe(basename(options.filePath))
        evidence.push({ kind: "ui_state", label: "Office window title matches test file", passed: visible })
      }
      return evidence
    },
    analyzeFailure: async (result) => {
      const failed = result.evidence.filter((item) => !item.passed).map((item) => item.label).join(", ")
      return failed ? `Office validation failed: ${failed}` : "Office validation failed without objective evidence"
    },
    maxRepairAttempts: 1,
  }
}

export const OFFICE_CAPABILITY_MATRIX = [
  "open",
  "create_new_file",
  "open_existing_file",
  "edit",
  "save",
  "reopen",
  "read_visible_content",
] as const
