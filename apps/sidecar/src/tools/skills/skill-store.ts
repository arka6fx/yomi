// File-system layer for procedural-memory skills. Reads, writes, lists, and
// archives skills under ~/.yomi/skills/<name>/. Atomic writes (tmp + rename) so
// a crash mid-write never leaves a half-edited SKILL.md on disk.
//
// Pure: no LLM, no logging. The YOMI_NOTEPAD_DIR env override is honoured via
// notepadDir() so tests can redirect to a temp dir.

import {
  access,
  constants as fsConstants,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { notepadDir } from "../../memory/loader.js"
import { parseFrontmatter, renderSkillMarkdown, type FrontmatterParseError } from "./frontmatter.js"
import type { SkillFull, SkillManifest, SkillSummary } from "./skill-types.js"
import { validateSkillName, SkillValidationError } from "./skill-types.js"

export { SkillValidationError }
export { FrontmatterParseError }

export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`skill not found: ${name}`)
    this.name = "SkillNotFoundError"
  }
}

export class SkillAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`skill already exists: ${name}`)
    this.name = "SkillAlreadyExistsError"
  }
}

export class SkillPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillPathError"
  }
}

// Path-traversal blocker for supporting files. Re-uses the same principle as
// the agent's path-security guard but kept inline because the canonical
// `checkYomiPath` lives in tools/guardrails and has tool-call concerns we
// don't need here.
export function safeJoin(rootDir: string, relPath: string): string {
  if (!relPath) throw new SkillPathError("path is required")
  // Reject absolute paths outright.
  if (relPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relPath)) {
    throw new SkillPathError(`absolute paths are not allowed: ${relPath}`)
  }
  // Normalise and ensure the result is still under rootDir.
  const candidate = resolve(rootDir, relPath)
  const root = resolve(rootDir) + sep
  if (candidate !== resolve(rootDir) && !candidate.startsWith(root)) {
    throw new SkillPathError(`path escapes skill directory: ${relPath}`)
  }
  return candidate
}

function skillsRoot(): string {
  return join(notepadDir(), "skills")
}

function skillDir(name: string): string {
  return join(skillsRoot(), name)
}

function skillFilePath(name: string, relPath: string): string {
  return safeJoin(skillDir(name), relPath)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function atomicWriteFile(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, content, "utf-8")
  try {
    await rename(tmp, target)
  } catch (err) {
    // Best-effort cleanup of the tmp file; the rename may have partially
    // succeeded in unusual filesystems.
    try {
      await rm(tmp, { force: true })
    } catch {
      // ignore
    }
    throw err
  }
}

async function readSkillMarkdown(name: string): Promise<string> {
  const path = join(skillDir(name), "SKILL.md")
  try {
    return await readFile(path, "utf-8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SkillNotFoundError(name)
    }
    throw err
  }
}

export async function readSkill(name: string): Promise<SkillFull> {
  validateSkillName(name)
  const dir = skillDir(name)
  await ensureSkillsDir()
  const raw = await readSkillMarkdown(name)
  const { manifest, body } = parseFrontmatter(raw)
  const files = await listSkillFiles(name)
  return { manifest, body, path: dir, files }
}

// Read a supporting file under the skill directory. Returns the raw bytes as a
// string (text-only v1; binary assets are out of scope per spec).
export async function readSkillFile(name: string, relPath: string): Promise<string> {
  validateSkillName(name)
  const path = skillFilePath(name, relPath)
  return await readFile(path, "utf-8")
}

export async function listSkillFiles(name: string): Promise<string[]> {
  validateSkillName(name)
  const dir = skillDir(name)
  if (!(await exists(dir))) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    if (e.isFile() && e.name === "SKILL.md") continue
    if (e.isFile()) out.push(e.name)
    if (e.isDirectory() && !e.name.startsWith(".")) {
      const sub = await readdir(join(dir, e.name), { withFileTypes: true })
      for (const s of sub) {
        if (s.isFile()) out.push(`${e.name}/${s.name}`)
      }
    }
  }
  return out.sort()
}

export async function writeSkill(
  name: string,
  body: string,
  opts: { manifest: Partial<SkillManifest> & { name: string; description: string } },
): Promise<SkillFull> {
  const validatedName = validateSkillName(name)
  const dir = skillDir(validatedName)
  // Ensure the skills root exists — important when called from the agent
  // tools layer before the sidecar's initMemoryDir hook has run.
  await ensureSkillsDir()
  // Fail loud if the skill already exists — callers wanting overwrite use
  // `editSkill` instead. Stops accidental `skill_create` of a duplicate.
  if (await exists(join(dir, "SKILL.md"))) {
    throw new SkillAlreadyExistsError(validatedName)
  }
  const now = new Date().toISOString()
  const manifest: SkillManifest = {
    name: validatedName,
    description: opts.manifest.description,
    version: opts.manifest.version ?? "1.0.0",
    author: opts.manifest.author,
    license: opts.manifest.license,
    platforms: opts.manifest.platforms,
    createdBy: opts.manifest.createdBy ?? "agent",
    createdAt: opts.manifest.createdAt ?? now,
    updatedAt: opts.manifest.updatedAt ?? now,
    pinned: opts.manifest.pinned,
    metadata: opts.manifest.metadata,
    extra: opts.manifest.extra,
  }
  await mkdir(dir, { recursive: true })
  const markdown = renderSkillMarkdown(manifest, body)
  await atomicWriteFile(join(dir, "SKILL.md"), markdown)
  return { manifest, body, path: dir, files: [] }
}

export async function editSkill(
  name: string,
  body: string,
  opts: { manifest?: Partial<SkillManifest>; expectedUpdatedAt?: string } = {},
): Promise<SkillFull> {
  const validatedName = validateSkillName(name)
  const existing = await readSkill(validatedName)
  if (opts.expectedUpdatedAt && existing.manifest.updatedAt !== opts.expectedUpdatedAt) {
    throw new SkillValidationError(
      `skill ${name} was modified concurrently (expected updatedAt=${opts.expectedUpdatedAt}, got ${existing.manifest.updatedAt})`,
    )
  }
  const now = new Date().toISOString()
  const manifest: SkillManifest = {
    ...existing.manifest,
    ...(opts.manifest ?? {}),
    name: validatedName, // immutable
    createdBy: existing.manifest.createdBy, // immutable
    createdAt: existing.manifest.createdAt, // immutable
    updatedAt: now,
  }
  const markdown = renderSkillMarkdown(manifest, body)
  await atomicWriteFile(join(skillDir(validatedName), "SKILL.md"), markdown)
  const files = await listSkillFiles(validatedName)
  return { manifest, body, path: skillDir(validatedName), files }
}

export async function writeSkillFile(
  name: string,
  relPath: string,
  content: string,
  opts: { maxBytes?: number } = {},
): Promise<string> {
  const validatedName = validateSkillName(name)
  const max = opts.maxBytes ?? 1024 * 1024 // 1 MiB per spec
  if (Buffer.byteLength(content, "utf-8") > max) {
    throw new SkillValidationError(
      `supporting file too large: ${Buffer.byteLength(content, "utf-8")} > ${max} bytes`,
    )
  }
  const path = skillFilePath(validatedName, relPath)
  await atomicWriteFile(path, content)
  return path
}

export async function removeSkillFile(name: string, relPath: string): Promise<void> {
  const validatedName = validateSkillName(name)
  const path = skillFilePath(validatedName, relPath)
  await rm(path, { force: true })
}

// Soft delete: move the skill directory into ~/.yomi/skills/.archive/<name>-<ts>/
// so the curator or user can un-archive. Returns the archive path.
export async function archiveSkill(name: string): Promise<string> {
  const validatedName = validateSkillName(name)
  const sourceDir = skillDir(validatedName)
  if (!(await exists(sourceDir))) throw new SkillNotFoundError(validatedName)
  const archiveRoot = join(skillsRoot(), ".archive")
  await mkdir(archiveRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const targetDir = join(archiveRoot, `${validatedName}-${stamp}`)
  await rename(sourceDir, targetDir)
  return targetDir
}

// Un-archive: move the most recent archive of a given name back into the
// skills root. Returns the restored path.
export async function unarchiveSkill(name: string): Promise<string> {
  const validatedName = validateSkillName(name)
  const archiveRoot = join(skillsRoot(), ".archive")
  if (!(await exists(archiveRoot))) throw new SkillNotFoundError(name)
  const entries = await readdir(archiveRoot, { withFileTypes: true })
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.startsWith(`${validatedName}-`))
    .map((e) => join(archiveRoot, e.name))
    .sort()
    .reverse()
  if (candidates.length === 0) throw new SkillNotFoundError(name)
  const targetDir = skillDir(validatedName)
  await rename(candidates[0]!, targetDir)
  return targetDir
}

export async function ensureSkillsDir(): Promise<void> {
  await mkdir(skillsRoot(), { recursive: true })
  await mkdir(join(skillsRoot(), ".archive"), { recursive: true })
}

// Read the on-disk skill list with parsed manifests. Skips skills that fail to
// parse — returns a malformed entry so the caller can surface a warning.
export async function listSkills(): Promise<
  Array<{ summary: SkillSummary; manifest: SkillManifest | null; parseError?: string }>
> {
  await ensureSkillsDir()
  const root = skillsRoot()
  const entries = await readdir(root, { withFileTypes: true })
  const out: Array<{
    summary: SkillSummary
    manifest: SkillManifest | null
    parseError?: string
  }> = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith(".")) continue
    const dir = join(root, e.name)
    const skillMd = join(dir, "SKILL.md")
    if (!(await exists(skillMd))) continue
    const isArchived = false
    let manifest: SkillManifest | null = null
    let parseError: string | undefined
    try {
      const raw = await readFile(skillMd, "utf-8")
      const parsed = parseFrontmatter(raw)
      manifest = parsed.manifest
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }
    let fileCount = 0
    try {
      const files = await listSkillFiles(e.name)
      fileCount = files.length
    } catch {
      // ignore
    }
    const summary: SkillSummary = {
      name: e.name,
      description: manifest?.description ?? "(unparsed)",
      version: manifest?.version ?? "0.0.0",
      createdBy: manifest?.createdBy ?? "user",
      pinned: manifest?.pinned === true,
      fileCount,
      lastActivityAt: null,
      useCount: 0,
      viewCount: 0,
    }
    out.push({ summary, manifest, parseError, ...(isArchived ? {} : {}) })
    // The `isArchived` flag is reserved for a future listing of the
    // .archive/ directory; the main list excludes it.
    void isArchived
  }
  return out
}

export async function skillExists(name: string): Promise<boolean> {
  const validatedName = validateSkillName(name)
  return await exists(join(skillDir(validatedName), "SKILL.md"))
}

// Resolve the absolute path of a skill directory (or throw if missing).
export function resolveSkillPath(name: string): string {
  const validatedName = validateSkillName(name)
  return skillDir(validatedName)
}

// Helper used by the system-prompt index: total number of non-archived
// skills, including ones that failed to parse (counted as best-effort).
export async function countActiveSkills(): Promise<number> {
  const skills = await listSkills()
  return skills.length
}

// Reserved for future use; computes a relative path under the skill dir so
// the system-prompt index can link to a file with `<name>/references/foo.md`.
export function relPath(skillPath: string, absFile: string): string {
  return relative(skillPath, absFile).split(sep).join("/")
}

// Check that a file is a real file (used to differentiate files vs dirs when
// reading the manifest above).
export async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}
