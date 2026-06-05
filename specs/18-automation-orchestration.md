# Spec 18 — Automation Orchestration & Mission Control

## Purpose

Turn the agent path into a transparent, self-improving orchestrator: every
automation **plans → delegates → executes → validates → recovers → learns** and
streams its progress to the desktop. This is the implementation of the agent
path described in Spec 08, evolved onto **LangGraph** with a typed provider/
sub-agent layer and a learning store.

Chat, overlay, screen-Q&A, and code-gen are **unchanged** — they stay on the
fast path (Spec 02) and never enter the graph. Only automation requests (the
intent router's `agent` decision, Spec 07) run through the AutomationGraph.

## Locked Decisions

1. **Graph wraps the ReAct loop; it does not replace chat.** The AutomationGraph
   owns planning/validation/recovery/completion around a bounded execution
   burst. The fast/chat path never loads LangChain (`runGraph` is lazy-imported
   in `index.ts`). `YOMI_LEGACY_AGENT=1` falls back to the original AI-SDK loop.
2. **State is serializable; deps are not.** Graph state (`graph/state.ts`) holds
   only checkpointable fields. Per-request, non-serializable handles (emit,
   signal, tools, guards, model factory, uia) live on `GraphDeps` so a future
   checkpointer drop-in stays clean.
3. **Existing SSE events only.** Node lifecycle maps to the existing
   `automation_*` / `agent_*` events via `EventBridge` (`graph/events.ts`), so
   the desktop store + Dynamic Island need no protocol change.
4. **Provider-routed sub-agents within one Execution node.** No per-agent
   subgraphs. The Planning node classifies a domain; Execution scopes the tool
   set and prompt to that sub-agent. Agents that declare no tool scope inherit
   the **full** set, so existing flows (WhatsApp, Notepad) cannot regress.
5. **Validation is tri-state.** A sub-agent's `validate()` returns
   `pass | fail | inconclusive`; it only overrides on positive evidence,
   otherwise the generic rubric (no error / no failed tool) applies.

## Architecture

```
intent router (agent)  →  runGraph (graph/run.ts)
   AutomationGraph (graph/graph.ts):
     Orchestrator → Planning → Memory → {HumanApproval | Execution}
                                          → Validation → {Recovery | Completion}
   per-node deps: GraphDeps (emit, signal, hooks, guards, tools, uia, bridge)
   node lifecycle ──► EventBridge ──► automation_* / agent_* SSE ──► desktop store
```

### Graph nodes (`apps/sidecar/src/graph/nodes/`)

- **Orchestrator** — seed conversation from history + user turn.
- **Planning** — classify risk + execution mode; `resolveAgent(goal)` picks the
  sub-agent; emits a "Spawned <Agent>" timeline entry.
- **Memory** — build the bounded system-prompt bundle (Spec 10) **and** consult
  the Knowledge Base, injecting a "Prior experience" hint.
- **HumanApproval** — coarse gate, off by default (`YOMI_GRAPH_APPROVAL_GATE`);
  per-tool act-bus confirms (Spec 16) carry the real approvals.
- **Execution** — bounded ReAct burst (`BURST_STEPS`). Scopes the merged tool
  set to the active sub-agent and prepends its system hint. Streams `agent_text`
  / `agent_tool_call` / `agent_tool_result` / `agent_step`.
- **Validation** — runs the sub-agent's `validate()`, else the rubric. Routes to
  Recovery on failure (up to `MAX_RECOVERIES`).
- **Recovery** — appends a corrective instruction; reuses a
  previously-successful fix from the Knowledge Base when one matches.
- **Completion** — emits the terminal event, writes memory (pro/max), and
  records the run + any successful recovery into the Knowledge Base.

### Providers (`apps/sidecar/src/automation/providers/`)

Typed execution backends implementing `healthCheck / diagnostics / repair`:
`native` (UIA, Spec 16), `browser` (Playwright MCP, Spec 17), and `api` /
`workflow` stubs. `GET /automation/health` reports each one (seeds a self-test
orchestrator).

### Sub-agents (`apps/sidecar/src/automation/agents/`)

`resolveAgent(goal)` reuses `classifyAutomationOwner` (`automation/runs.ts`) to
pick a `SubAgent`
(`{ provider, toolNames?, toolPrefixes?, systemHint, validate() }`).
`scopeTools` filters the merged tool set, always keeping a read-only base.
**Spotify** is the reference deep agent (scoped tools + real now-playing
`validate()`); **browser** is prefix-scoped to `browser_*`;
messaging/calendar/windows/research/general inherit the full set.

### Learning / Knowledge Base (`apps/sidecar/src/automation/knowledge.ts`)

SQLite at `~/.yomi/knowledge.db` (in-memory fallback). Records every run
(`recordWorkflow`, success and failure: agent, goal, tool sequence, steps,
recovery count, duration) and learned recoveries (`recordRecovery`).
`recallKnowledge(agentId, goal)` returns a token-overlap-ranked, bounded slice
(<200ms); `knowledgeHint` renders the prompt block.
`GET /automation/knowledge?goal=` previews what an agent would consult.

## Sidecar Behavior

- **Entry:** `index.ts` `/query` (router → graph) and `/query/agent` (direct).
  Both stream SSE; `runGraph` drains a single-consumer channel into the stream.
- **Persistence:** `automation/runs.ts` writes run + timeline to
  `~/.yomi/automation.db`; `knowledge.ts` writes learning to
  `~/.yomi/knowledge.db`.
- **Transparency:** mission-control progress (preview, steps, timeline,
  waiting/approval, recovering, completed/failed) all flow as existing
  `automation_*` events; learning is surfaced via timeline entries ("Recalled
  prior experience", "Reusing a learned recovery", "Recorded a learned
  recovery").

## Tests

- `graph/graph.test.ts` — clean run, recovery + escalation cap, approval
  grant/deny (uses mock models, in-memory knowledge db).
- `automation/agents/registry.test.ts` — routing + tool scoping.
- `automation/agents/spotify.test.ts` — tri-state `validate()`.
- `automation/providers/health.test.ts` — native/browser health + repair.
- `automation/knowledge.test.ts` — record/recall, ranking, recovery recall,
  hint.

## Verification

CI gates: `bun run lint`, `bun run typecheck`, `bun run build:ci`,
`bun run test`. Manual (sidecar running, plan `max`):

1. `/query/agent` "play lofi on spotify" → timeline shows "Spawned Spotify
   Agent", scoped execution, and a Validation backed by the now-playing check.
2. Repeat a task → Memory node injects "Prior experience";
   `GET /automation/knowledge?goal=…` returns the recalled workflow.
3. "send a whatsapp to Alex…" → full toolset + act-bus approval (regression
   guard).
4. `GET /automation/health` → native + browser provider status.
5. Chat / screen-Q&A still answer on the fast path, unchanged.

## Files

- `specs/18-automation-orchestration.md` (this doc)
- `apps/sidecar/src/graph/**` — graph, nodes, state, deps, run, events, prompts,
  tool adapter
- `apps/sidecar/src/automation/providers/**`, `automation/agents/**`,
  `automation/knowledge.ts`, `automation/runs.ts`
- `apps/sidecar/src/index.ts` — `/automation/health`, `/automation/knowledge`

## Future Work

- **Mission Control UI** — a dedicated panel + timeline/preview/approval cards
  (data already flows to the desktop store).
- **Missions** — long-running, cross-session goals with their own persistence.
- **Workflow recording/replay** — promote recorded tool sequences to repeatable,
  schedulable workflows (the `workflow` provider).
- **Deeper validators** — per-domain `validate()` beyond Spotify; durable
  LangGraph `interrupt()` + checkpointer for approvals.
- **Self-test orchestrator** — drive every provider through health → execute →
  verify → repair on a schedule.
