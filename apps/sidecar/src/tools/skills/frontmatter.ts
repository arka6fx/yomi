// Tiny YAML frontmatter parser scoped to the fields we validate. Avoids the
// `js-yaml` dep — the SKILL.md frontmatter shape is small and stable, and a
// custom parser is easier to audit for round-trip safety. If a skill arrives
// with an exotic key, it lands in `manifest.extra` and is re-emitted verbatim
// on write so we never silently drop data.
//
// Supported frontmatter shape:
//
//   ---
//   name: github-pr-workflow
//   description: "GitHub PR lifecycle: branch, commit, open, CI, merge."
//   version: 1.1.0
//   author: Yomi Agent
//   license: MIT
//   platforms: [linux, macos, windows]
//   createdBy: agent
//   createdAt: 2026-06-08T12:00:00.000Z
//   updatedAt: 2026-06-08T12:00:00.000Z
//   pinned: false
//   metadata:
//     yomi:
//       tags: [GitHub, Pull-Requests]
//       relatedSkills: [github-auth]
//   ---
//
// List syntax is `[a, b, c]` only (no flow-style across newlines, no
// block-style `- a\n- b`). Strings may be bare or quoted with " or '.

import type { SkillManifest, SkillProvenance } from "./skill-types.js"

const KNOWN_SCALAR_KEYS = new Set([
  "name",
  "description",
  "version",
  "author",
  "license",
  "createdBy",
  "createdAt",
  "updatedAt",
  "pinned",
])

const KNOWN_LIST_KEYS = new Set(["platforms"])

const KNOWN_NESTED_KEYS = new Set(["metadata"])

interface ParseResult {
  manifest: SkillManifest
  body: string
}

export class FrontmatterParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FrontmatterParseError"
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

function isValidIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if (first === '"' && last === '"') {
      return unescapeQuoted(trimmed.slice(1, -1))
    }
    if (first === "'" && last === "'") {
      // Single-quoted YAML strings don't support backslash escapes — drop
      // literal backslashes so `\'` in a description round-trips cleanly.
      return trimmed.slice(1, -1).replace(/\\\\/g, "\\").replace(/\\'/g, "'")
    }
  }
  return trimmed
}

// Parse a list literal `[a, b, "c d", 'e f']`. Returns null if the input is
// not a list. Elements may be bare, double-quoted, or single-quoted.
function parseListLiteral(raw: string): string[] | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null
  const inner = trimmed.slice(1, -1).trim()
  if (!inner) return []
  const items: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ",") {
      const item = current.trim()
      if (item) items.push(item)
      current = ""
      continue
    }
    current += ch
  }
  const tail = current.trim()
  if (tail) items.push(tail)
  return items
}

function parseScalar(raw: string): string | boolean {
  const trimmed = raw.trim()
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  return unquote(trimmed)
}

// Split a single frontmatter line on the first ":" — keys with colons inside
// strings are unsupported (we don't need them for the known fields).
function splitKeyValue(line: string): { key: string; value: string } | null {
  const idx = line.indexOf(":")
  if (idx <= 0) return null
  const key = line.slice(0, idx).trim()
  const value = line.slice(idx + 1).trim()
  if (!key) return null
  return { key, value }
}

function parseYomiMetadata(
  lines: string[],
  startIdx: number,
): {
  value: { tags?: string[]; relatedSkills?: string[] } | undefined
  nextIdx: number
} {
  // Walk forward from the `metadata:` line, collecting `tags:` and
  // `relatedSkills:` keys at any indent level. We don't require a `yomi:`
  // intermediate key — the renderer collapses that nesting for file-format
  // ergonomics (the TS shape still carries `yomi` for forward-compatibility).
  const yomi: { tags?: string[]; relatedSkills?: string[] } = {}
  let i = startIdx + 1
  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (!line.trim()) {
      i++
      continue
    }
    // Exit the metadata block when we see a non-indented line.
    if (!/^\s+/.test(line)) break
    const tagsMatch = /^\s+tags\s*:\s*(.*)$/.exec(line)
    const relatedMatch = /^\s+relatedSkills\s*:\s*(.*)$/.exec(line)
    if (tagsMatch) {
      const list = parseListLiteral(tagsMatch[1] ?? "")
      if (list && list.length) yomi.tags = list
      i++
      continue
    }
    if (relatedMatch) {
      const list = parseListLiteral(relatedMatch[1] ?? "")
      if (list && list.length) yomi.relatedSkills = list
      i++
      continue
    }
    // Unknown indented line — keep scanning; it's a neighbouring block.
    i++
  }
  return {
    value: Object.keys(yomi).length > 0 ? yomi : undefined,
    nextIdx: i,
  }
}

export function parseFrontmatter(content: string): ParseResult {
  if (!content.startsWith("---")) {
    throw new FrontmatterParseError("SKILL.md is missing the leading '---' delimiter")
  }
  const afterOpen = content.slice(3)
  // Find the closing "---" on its own line. Allow a leading newline.
  const newlineIdx = afterOpen.indexOf("\n")
  if (newlineIdx === -1) {
    throw new FrontmatterParseError("SKILL.md frontmatter is not closed")
  }
  const afterFirstNewline = afterOpen.slice(newlineIdx + 1)
  const closeIdx = afterFirstNewline.indexOf("\n---")
  if (closeIdx === -1) {
    throw new FrontmatterParseError("SKILL.md frontmatter is not closed")
  }
  const yamlBlock = afterFirstNewline.slice(0, closeIdx)
  const afterClose = afterFirstNewline.slice(closeIdx + 4)
  // Skip exactly one newline after the closing --- so the body starts cleanly.
  const body = afterClose.startsWith("\n") ? afterClose.slice(1) : afterClose

  const lines = yamlBlock.split("\n")
  const fields: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim() || line.trim().startsWith("#")) continue
    if (line.startsWith(" ") || line.startsWith("\t")) {
      // Lines indented under a previous key are handled inline (metadata.yomi).
      continue
    }
    const split = splitKeyValue(line)
    if (!split) continue
    const { key, value } = split

    if (KNOWN_SCALAR_KEYS.has(key)) {
      fields[key] = parseScalar(value)
    } else if (KNOWN_LIST_KEYS.has(key)) {
      const list = parseListLiteral(value)
      if (list) fields[key] = list
    } else if (KNOWN_NESTED_KEYS.has(key) && value === "") {
      // Nested block — only `metadata:` is supported.
      const nested = parseYomiMetadata(lines, i)
      if (nested.value) {
        fields[key] = { yomi: nested.value }
      }
      i = nested.nextIdx - 1
    } else {
      extra[key] = value
    }
  }

  // Coerce + validate known fields.
  const name = typeof fields["name"] === "string" ? (fields["name"] as string).trim() : ""
  const description =
    typeof fields["description"] === "string" ? (fields["description"] as string).trim() : ""
  const version = typeof fields["version"] === "string" ? (fields["version"] as string) : "1.0.0"
  const author = typeof fields["author"] === "string" ? (fields["author"] as string) : undefined
  const license = typeof fields["license"] === "string" ? (fields["license"] as string) : undefined
  const platforms = Array.isArray(fields["platforms"])
    ? (fields["platforms"] as unknown[]).filter((p): p is string => typeof p === "string")
    : undefined
  const createdBy = ((): SkillProvenance => {
    const v = fields["createdBy"]
    if (v === "agent" || v === "user" || v === "bundled") return v
    return "user"
  })()
  const createdAtRaw =
    typeof fields["createdAt"] === "string" ? (fields["createdAt"] as string) : ""
  const updatedAtRaw =
    typeof fields["updatedAt"] === "string" ? (fields["updatedAt"] as string) : ""
  const createdAt = isValidIsoDate(createdAtRaw) ? createdAtRaw : new Date(0).toISOString()
  const updatedAt = isValidIsoDate(updatedAtRaw) ? updatedAtRaw : new Date(0).toISOString()
  const pinned = fields["pinned"] === true

  if (!name) throw new FrontmatterParseError("SKILL.md frontmatter is missing 'name'")
  if (!description) {
    throw new FrontmatterParseError("SKILL.md frontmatter is missing 'description'")
  }

  const metadataRaw = fields["metadata"]
  const yomiMeta =
    metadataRaw && typeof metadataRaw === "object" && "yomi" in metadataRaw
      ? (metadataRaw as { yomi?: { tags?: string[]; relatedSkills?: string[] } }).yomi
      : undefined

  const manifest: SkillManifest = {
    name,
    description,
    version,
    author,
    license,
    platforms,
    createdBy,
    createdAt,
    updatedAt,
    pinned,
    metadata: yomiMeta ? { yomi: yomiMeta } : undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  }
  return { manifest, body }
}

function escapeIfNeeded(value: string): string {
  if (/[":'#]/.test(value) || value !== value.trim() || value === "") {
    // Escape backslashes first, then double-quotes. Single quotes don't
    // need escaping inside a double-quoted string.
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return value
}

function unescapeQuoted(value: string): string {
  // Inverse of escapeIfNeeded. Handles backslash-escaped backslashes and
  // double-quotes inside a double-quoted string.
  let result = ""
  let i = 0
  while (i < value.length) {
    const ch = value[i]
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1]
      if (next === "\\" || next === '"') {
        result += next
        i += 2
        continue
      }
    }
    if (ch !== undefined) result += ch
    i++
  }
  return result
}

function renderList(values: string[] | undefined): string {
  if (!values || values.length === 0) return "[]"
  return `[${values.map(escapeIfNeeded).join(", ")}]`
}

export function renderFrontmatter(manifest: SkillManifest): string {
  const lines: string[] = ["---"]
  lines.push(`name: ${escapeIfNeeded(manifest.name)}`)
  lines.push(`description: ${escapeIfNeeded(manifest.description)}`)
  if (manifest.version) lines.push(`version: ${escapeIfNeeded(manifest.version)}`)
  if (manifest.author) lines.push(`author: ${escapeIfNeeded(manifest.author)}`)
  if (manifest.license) lines.push(`license: ${escapeIfNeeded(manifest.license)}`)
  if (manifest.platforms) lines.push(`platforms: ${renderList(manifest.platforms)}`)
  lines.push(`createdBy: ${manifest.createdBy}`)
  lines.push(`createdAt: ${manifest.createdAt}`)
  lines.push(`updatedAt: ${manifest.updatedAt}`)
  if (manifest.pinned) lines.push(`pinned: true`)
  if (manifest.metadata?.yomi) {
    const yomi = manifest.metadata.yomi
    const hasTags = Array.isArray(yomi.tags) && yomi.tags.length > 0
    const hasRelated = Array.isArray(yomi.relatedSkills) && yomi.relatedSkills.length > 0
    if (hasTags || hasRelated) {
      // We collapse the `metadata.yomi` nesting in the file format: the
      // stored shape uses `tags:` / `relatedSkills:` directly under
      // `metadata:` so the file is grep-friendly and the parser doesn't
      // need a multi-level key walk. The TS API keeps the `yomi` shape
      // for future-proofing.
      lines.push("metadata:")
      if (hasTags && yomi.tags) lines.push(`  tags: ${renderList(yomi.tags)}`)
      if (hasRelated && yomi.relatedSkills)
        lines.push(`  relatedSkills: ${renderList(yomi.relatedSkills)}`)
    }
  }
  if (manifest.extra) {
    for (const [k, v] of Object.entries(manifest.extra)) {
      // Best-effort: stringify unknown values. Booleans / numbers / strings get
      // a sensible rendering; anything else is JSON-encoded.
      if (typeof v === "boolean" || typeof v === "number") {
        lines.push(`${k}: ${String(v)}`)
      } else if (typeof v === "string") {
        lines.push(`${k}: ${escapeIfNeeded(v)}`)
      } else {
        lines.push(`${k}: ${escapeIfNeeded(JSON.stringify(v))}`)
      }
    }
  }
  lines.push("---")
  return lines.join("\n")
}

export function renderSkillMarkdown(manifest: SkillManifest, body: string): string {
  const fm = renderFrontmatter(manifest)
  return `${fm}\n\n${body.replace(/^\n+/, "")}\n`
}
