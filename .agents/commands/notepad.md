Load Yomi's notepad context before starting a long task.

Steps:
1. Check if `~/.yomi/yomi.md` exists. If yes, read it (user identity, prefs, standing instructions).
2. Check if `~/.yomi/memory.md` exists. If yes, read it (long-term memory summary).
3. Check if `~/.yomi/memory-index.md` exists. List the entries.
4. Find today's session log: `~/.yomi/sessions/$(date +%Y-%m-%d)-*.md`. Read if exists.
5. Summarise what you learned: user context, relevant past decisions, open threads.

If `~/.yomi/` doesn't exist yet (first run), say so and suggest running the Phase 1 setup to initialise the notepad.
