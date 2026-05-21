Review the proposed change against Yomi's four-layer architecture invariants.

Read `specs/01-architecture.md` and `CLAUDE.md`, then check the current git diff (`git diff`) against these rules:

**Hard invariants (any violation is a blocker):**
1. LLM API keys must NEVER appear in `apps/desktop/` or `apps/sidecar/` — they belong in `apps/backend/` only. The sidecar calls the backend to proxy LLM requests.
2. The fast path (`STT → screenshot → 1 LLM call → TTS`) must never block the UI thread or introduce a tool-selection loop.
3. The AI brain (router, ReAct loop, memory system) must live in `apps/sidecar/`, not in `apps/desktop/`. The desktop is shell only.
4. The intent router runs at the START of each turn and never switches models mid-conversation.

**Soft checks (flag but don't block):**
- Are new dependencies added to the right app/package?
- Does a new tool belong to the fast path or agent path?
- Would this change affect prompt caching (new tokens added before the cache boundary)?

Report: list each invariant as PASS / FAIL / N/A with a one-line explanation.
