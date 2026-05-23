---
description: Load ~/.yomi/ notepad context before a long session
---

Load the Yomi notepad before starting a complex task.

## 1 — User identity and prefs

```bash
cat ~/.yomi/yomi.md 2>/dev/null
```

If missing: "~/.yomi/yomi.md not found — create it to store your identity, preferences, and standing instructions."

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

```
Notepad loaded

User context:   <one line from yomi.md>
Memory entries: <N from memory-index.md>
Open threads:   <any unresolved items from today's session log>
```

If `~/.yomi/` doesn't exist: "Notepad not initialised. Create `~/.yomi/yomi.md` with your identity and standing instructions."
