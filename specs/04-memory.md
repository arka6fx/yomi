# Spec 04 — Memory (Notepad)

## Purpose

Define the filesystem memory system (`~/.yomi/`), loading strategy, compaction algorithm, and retrieval mechanism. The notepad is the agent's persistent RAM — no database, no vector store.

## Invariants

- `yomi.md` is ALWAYS preloaded into every request. No exceptions.
- Memory files are plain markdown. No proprietary format.
- Retrieval is agentic (agent decides what to read), not automatic embedding-based lookup.
- Compaction never deletes facts — it only restructures. Original sessions are kept in `sessions/`.
- The memory system must work fully offline.

## Detailed Design

### File Layout

```
~/.yomi/
  yomi.md              # ALWAYS preloaded. User identity, prefs, standing instructions.
  memory.md            # Curated long-term memory. Updated by compaction.
  memory-index.md      # One line per memory/project/session file. Read first.
  projects/
    <slug>/
      context.md       # Project facts, key files, decisions, constraints.
      scratchpad.md    # Agent's working notes. Ephemeral — overwritten each task.
  sessions/
    YYYY-MM-DD-<topic>.md  # Session summary. Append-only. Named for navigation.
```

### `yomi.md` Schema

User-authored. Yomi reads it at every request and never overwrites it (only appends on explicit user request).

```markdown
# About me
[name, role, working style, timezone, language preference]

# My tools
[apps I use, devices, accounts I've connected]

# How I like Yomi to behave
[response length, tone, when to ask vs assume, things to never do]

# Standing instructions
[recurring preferences: always use dark theme, prefer Python, etc.]

# Tools allowlist extension
tools_allowlist: []
```

### `memory.md` Schema

Agent-maintained. Updated after compaction.

```markdown
# Long-term memory — [last updated: YYYY-MM-DD]

## Facts about me
[stable facts: family, location, job, preferences]

## Decisions
[architectural decisions, preferences, things we settled]

## Open threads
[unfinished tasks, things to follow up]

## Recent context (last 2 weeks)
[brief summary of recent significant sessions]
```

### `memory-index.md` Schema

One line per file. Read before reading any memory file.

```
projects/yomi/context.md — Yomi project: monorepo layout, stack decisions (2026-05-21)
sessions/2026-05-21-pricing.md — Explored Stripe vs Paddle; chose Stripe (2026-05-21)
```

### Loading Strategy

| Content | When loaded | Rationale |
|---|---|---|
| `yomi.md` | Always, every turn | User identity — must be in every context |
| `memory.md` (summary section) | Always, every turn | Key facts + open threads |
| `memory-index.md` | Always, every turn | Agent needs to know what exists |
| `projects/<slug>/context.md` | JIT when user references a project | Save tokens on unrelated tasks |
| `sessions/*.md` | JIT on agent request | Historical lookup, not routine |
| Full `memory.md` | JIT when agent needs depth | Only when summary is insufficient |

Files the user has open: store path + type + last-modified only. Fetch full content on demand.

### Compaction Algorithm

Triggered when the live context window exceeds `COMPACT_THRESHOLD` (default: 70% of model's context limit).

```
1. RECALL PASS
   - Scan entire conversation history
   - Extract: facts, decisions, completed steps, open threads, user corrections
   - Do not discard anything — prefer over-inclusion at this stage

2. PRECISION PASS
   - Rewrite the recall output: remove redundancy, tighten prose
   - Keep: decisions (with reasoning), open threads, corrections, key facts
   - Drop: intermediate reasoning steps, tool call logs already in hook_logs

3. WRITE
   - Append precision output to memory.md (under "Recent context")
   - Overwrite scratchpad.md with current task state only
   - Reset live conversation window to: system prompt + yomi.md + new memory summary

4. SESSION SAVE
   - Write full recall output (uncompressed) to sessions/YYYY-MM-DD-<topic>.md
   - Add entry to memory-index.md
```

### Retrieval Tools

The agent has three retrieval primitives:

```typescript
list_files(dir: "~/.yomi/" | "~/.yomi/projects/" | "~/.yomi/sessions/")
// Returns: array of { path, size, modified } — metadata only, no content

read_file(path: string)
// Returns: full file content. JIT — only call when you've decided this file is relevant.

search(query: string, dir?: string)
// Runs: rg --ignore-case query dir (defaults to ~/.yomi/)
// Agent can call multiple times with synonyms: "budget" → "money, finances, cost, spend"
```

**No vector embeddings.** At single-user scale (~2MB total memory), ripgrep is faster, cheaper, and more precise than approximate nearest-neighbor search. Add a secondary embedding index only if grep across sessions becomes a measured bottleneck.

### Agent Note-Taking (Scratchpad)

During any agent task longer than ~3 steps, the agent writes its working state to `scratchpad.md`:

```markdown
# Task: [task description] — [started: timestamp]

## Goal
[what done looks like]

## Steps completed
- [x] Searched for X → found Y
- [x] Drafted email

## Current step
[ ] Waiting for user confirmation before sending

## Open questions
- Should I CC Riya?
```

This externalises working memory to disk. The agent can re-read it after compaction to resume exactly where it left off — the same technique coding agents use to stay coherent over long horizons.

## Files to change

- `apps/sidecar/src/index.ts` — initialize memory on startup

## Files to create

- `apps/sidecar/src/memory/loader.ts` — Load yomi.md, memory.md summary, memory-index.md
- `apps/sidecar/src/memory/compactor.ts` — Compaction algorithm (recall → precision → write)
- `apps/sidecar/src/memory/retrieval.ts` — list_files, read_file, search (ripgrep)
- `apps/sidecar/src/memory/scratchpad.ts` — Scratchpad read/write for long tasks

## Open Questions

- Cloud sync of `~/.yomi/`: encrypt with user's key, sync via `memory_blobs` table in backend. Opt-in. Don't auto-sync by default.
- Multi-device sync conflict resolution: last-write-wins on `yomi.md`; merge (not overwrite) on `memory.md`. To spec when implementing Phase 3.
