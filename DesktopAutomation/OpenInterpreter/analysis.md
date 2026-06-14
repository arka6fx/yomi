# Open Interpreter / Codex Knowledge Extraction

## Most Relevant Patterns

### Structured Event Stream
- Execution is modeled as typed lifecycle and item events.
- Command execution, file changes, MCP calls, web search, reasoning, and todo lists have distinct payloads.
- Live output uses replayable event history plus broadcast subscribers.

Yomi opportunity: standardize automation timeline events so UI can replay runs and new viewers can subscribe mid-run.

### Approval System
- Decision model: allow, prompt, forbidden.
- Approval policies vary by mode: never, on failure, on request, unless trusted, granular.
- Approval cache avoids re-prompting for equivalent approved operations.
- Guardian review uses a separate model to assess risky actions.

Yomi opportunity: expand action approval from basic destructive confirmation into a policy engine with cached approvals and optional model-assisted risk review.

### Tool Registry
- Tool specs are built conditionally from runtime config.
- Tool handlers expose mutation classification plus pre/post hook payloads.
- Tool search/suggest supports dynamic discovery.

Yomi opportunity: align plugin tools, desktop tools, and future MCP tools behind one registry with mutation metadata and discoverability.

### Context Compaction
- Conversation history is compacted into a handoff summary preserving progress, decisions, constraints, next steps, and critical references.
- Old tool output is pruned before expensive summarization.

Yomi opportunity: Yomi already has compression; borrow the explicit handoff schema for automation runs and UI sessions.

### Sandbox and Exec Safety
- Sandbox manager selects platform-specific isolation where available.
- Dangerous command heuristics and network policy are checked before execution.
- On sandbox denial, execution can retry without sandbox only after approval cache allows it.

Yomi opportunity: keep sidecar filesystem/bash tools behind explicit policy and cache approval only for exact operations.

## Adoption Candidates

| Candidate | Potential | Notes |
|---|---:|---|
| Typed automation event stream | high | Improves debugging and replay |
| Approval policy modes | high | Better UX and safety |
| Approval cache | medium | Avoids repeat confirmations |
| Tool mutation metadata | high | Helps risk classification |
| Guardian-style review | low | Useful later, adds cost/latency |
