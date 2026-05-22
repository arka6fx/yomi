# Spec 10 — Memory

## Purpose

Define Yomi's persistent memory layer: how user preferences, facts, and context are stored, retrieved, and compacted. Memory lives entirely on-device in `~/.yomi/notepad/`.

## Invariants

- Memory is stored on-device only — never synced to cloud.
- Each fact is a `.md` file in `~/.yomi/notepad/`.
- Memory is read at the start of every turn (injected into system prompt).
- Memory is written at the end of every agent turn (via auto-memory hook).
- Compaction runs when the notepad directory exceeds 100 entries.
- Notepad entries older than 90 days without access are summarised into a daily digest then deleted.

## Detailed Design

### Storage format

```
~/.yomi/notepad/
  └── YYYY-MM-DD-HHmmss-<slug>.md
```

Each file is a Markdown file with frontmatter:

```yaml
---
key: "user-name"
created: 2025-06-15T10:30:00Z
accessed: 2025-06-16T14:00:00Z
source: "auto"  # "auto" | "explicit" | "compaction"
---
Arkady prefers dark mode and responds best to concise, direct answers.
```

### Retrieval

On every turn, the `MEMORY_SNIPPET` section of the system prompt is populated by:

```typescript
function getMemorySnippet(maxChars: number = 2000): string {
  const files = fs.readdirSync(NOTEPAD_DIR)
    .map(f => ({ path: f, stat: fs.statSync(path.join(NOTEPAD_DIR, f)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)  // most recently accessed first
    .slice(0, 10)  // top 10 entries

  let snippet = "## Memory\n"
  for (const file of files) {
    const content = fs.readFileSync(path.join(NOTEPAD_DIR, file.path), "utf-8")
    const body = content.split("---\n")[2] || content
    if (snippet.length + body.length > maxChars) break
    snippet += `- ${body.trim()}\n`
    // update accessed timestamp
    fs.utimesSync(file.path, new Date(), new Date())
  }
  return snippet
}
```

### Writing

The auto-memory hook calls `writeNotepad(key, content)`:

```typescript
function writeNotepad(key: string, content: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const filename = `${new Date().toISOString().slice(0,10)}-${Date.now()}-${slug}.md`
  const frontmatter = [
    "---",
    `key: ${key}`,
    `created: ${new Date().toISOString()}`,
    `accessed: ${new Date().toISOString()}`,
    `source: auto`,
    "---",
    "",
    content,
  ].join("\n")
  fs.writeFileSync(path.join(NOTEPAD_DIR, filename), frontmatter)
  return filename
}
```

### Compaction

```typescript
function compactNotepad(): void {
  const files = fs.readdirSync(NOTEPAD_DIR)
    .map(f => ({ path: f, fullPath: path.join(NOTEPAD_DIR, f) }))
    .filter(f => f.path.endsWith(".md"))

  if (files.length <= 100) return

  // Group by key, keep most recent for each key
  const byKey = new Map<string, typeof files>()
  for (const f of files) {
    const key = extractKey(f.fullPath)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(f)
  }

  // For each key: merge multiple entries into one via LLM summarisation
  const model = createModel()  // gpt-4.1-mini
  for (const [key, entries] of byKey) {
    if (entries.length <= 1) continue
    const contents = entries.map(f => fs.readFileSync(f.fullPath, "utf-8")).join("\n\n")
    const summarised = await generateText({
      model,
      prompt: `Summarise these notes into one concise entry (max 200 chars):\n${contents}`,
    })
    // Delete old entries, write merged one
    entries.forEach(f => fs.unlinkSync(f.fullPath))
    writeNotepad(key, summarised.text)
  }

  // After dedup, if still > 100: delete oldest entries
  const remaining = fs.readdirSync(NOTEPAD_DIR).filter(f => f.endsWith(".md"))
  if (remaining.length > 100) {
    const sorted = remaining
      .map(f => ({ path: f, stat: fs.statSync(path.join(NOTEPAD_DIR, f)) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    sorted.slice(0, sorted.length - 100).forEach(f => fs.unlinkSync(f.fullPath))
  }
}
```

### Age-out

A weekly scheduled task (or triggered at sidecar start) deletes entries older than 90 days. Before deletion, entries are summarised into a daily digest markdown file.

## Files to create

- `apps/sidecar/src/memory/notepad.ts` — read, write, compact, age-out functions.
- `apps/sidecar/src/memory/compactor.ts` — LLM-based merging of duplicate-key entries.

## Open Questions

- Should memory be encrypted at rest? → Phase 1. Phase 0 stores plaintext.
- Should there be an explicit "remember this" / "forget that" command? → deferred.
