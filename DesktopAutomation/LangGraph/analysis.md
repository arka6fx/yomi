# LangGraph Knowledge Extraction

## Most Relevant Patterns

### Checkpointing
- Checkpoints store versioned channel state, seen versions, updated channels, metadata, parent checkpoint IDs, and run IDs.
- Delta channels periodically snapshot reducer-backed state to bound replay cost.
- Durability modes include sync, async, and exit-time persistence.

Yomi opportunity: use checkpoint-style state for long autonomous desktop workflows so interrupted automation can resume with exact graph state, pending tool calls, and recovery context.

### Human-In-The-Loop
- Interrupts raise a structured graph interrupt with a stable interrupt ID.
- Resume values are mapped back to pending interrupts by ID or index.
- Interrupt-before and interrupt-after hooks can be compiled into the graph.

Yomi opportunity: replace one-off confirmation prompts with resumable interrupt IDs for destructive actions, payment flows, send-message flows, and app-install/uninstall flows.

### Parallel Fan-Out/Fan-In
- `Send(node, arg)` dynamically creates parallel tasks.
- Waiting edges act as N-way barriers before reduce nodes run.
- Task IDs are deterministic from checkpoint, namespace, step, node name, and trigger.

Yomi opportunity: use deterministic fan-out for parallel UI inspection, OCR regions, browser tab scans, and subagent research, then fan-in to a validation node.

### Error Handler Nodes
- Per-node and global error handlers receive structured error context.
- Failed nodes can resume directly into handlers after checkpoint restore.
- Retry policies can differ by exception type.

Yomi opportunity: model automation recovery as graph error handlers instead of only imperative recovery ladders.

### Timeout Policies
- Supports run timeout and idle timeout.
- Idle timeout refreshes on observable progress or explicit heartbeat.

Yomi opportunity: add heartbeat-based idle timeouts to agent mode to detect hung automation, frozen UIA helper calls, and stalled LLM streams.

### Stream Transformers
- Raw events are projected into values, updates, tasks, messages, custom, checkpoints, and debug streams.

Yomi opportunity: improve desktop SSE by separating user-visible messages from debug events, automation timeline events, and subgraph events.

## Adoption Candidates

| Candidate | Potential | Notes |
|---|---:|---|
| Resumable interrupt IDs | high | Safer approvals and better recovery |
| Node error handlers | high | Cleaner recovery semantics |
| Idle timeout with heartbeat | high | Prevents indefinite hangs |
| Deterministic task IDs | medium | Enables replay/cache stability |
| Delta checkpoint snapshots | medium | Useful for long memory/workflow histories |
| Stream transformer separation | medium | Better observability |
