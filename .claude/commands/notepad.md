---
description: Load ~/.yomi/ notepad context before a long session
allowed-tools: Bash, Read, Glob
---

Load the Yomi notepad before starting a complex task. This surfaces standing instructions, long-term memory, and recent session context.

## 1 — User identity and prefs

```bash
cat ~/.yomi/yomi.md 2>/dev/null
```

If missing: "~/.yomi/yomi.md not found — this is the primary context file. Create it to store your identity, preferences, and standing instructions for Yomi."

## 2 — Long-term memory

```bash
cat ~/.yomi/memory.md 2>/dev/null
```

If missing, skip silently.

## 3 — Memory index

```bash
cat ~/.yomi/memory-index.md 2>/dev/null
```

Print the index entries so you know what detailed memories are available on demand.

## 4 — Today's session log

```bash
ls ~/.yomi/sessions/ 2>/dev/null | grep "$(date +%Y-%m-%d)" | tail -1
```

If a session log exists for today, read it.

## 5 — Summary

Report what was loaded:

```
Notepad loaded

User context:   <one line from yomi.md>
Memory entries: <N from memory-index.md>
Open threads:   <any unresolved items mentioned in today's session log>
```

If `~/.yomi/` doesn't exist at all: "Notepad not initialised. Create `~/.yomi/yomi.md` with your identity and standing instructions to enable persistent context across sessions."
