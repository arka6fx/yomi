# Accessibility Insights Knowledge Extraction

## Most Relevant Patterns

### Multiple Tree Views
- Uses raw, control, and content UIA tree modes.
- Maintains selected element context and derives tree snapshots from that context.
- Hierarchy nodes precompute searchable properties and aggregate scan results from descendants.

Yomi opportunity: expose tree view mode in `get_ui_tree` and use control view by default for agent consumption, raw view for debugging, content view for summaries.

### Focus and Selection Tracking
- Polls current selection every 200ms.
- Debounces unchanged elements with UIA identity comparison.
- Pauses or clears stale contexts when switching app modes.

Yomi opportunity: add an optional lightweight current-target tracker for foreground automation and Mission Control.

### UIA Event Recording
- Records focus changed, structure changed, property changed, invoke, and selection events.
- Focus changed events are treated specially because they are global.
- Event logs include source element, event type, changed properties, and timestamp.

Yomi opportunity: add an automation debug/event recorder mode for diagnosing flaky tasks and learning focus-order paths.

### Pattern Inspection
- Patterns are first-class capabilities.
- Pattern methods are reflected and surfaced as invokable actions.
- Invocations return structured success/failure state.

Yomi opportunity: have the UIA helper include supported pattern metadata in snapshots and choose pattern-first actions before coordinate fallback.

### Rule Engine
- Accessibility rule results are attached to elements and flattened into issue lists.
- Rules identify missing names, bad properties, unsupported patterns, and tree issues.

Yomi opportunity: create automation-readiness rules for target elements: disabled, offscreen, no actionable pattern, unstable rect, wrong process, blocked app/domain.

### Testing Methodology
- Uses a sample app as a deterministic target.
- Launches target, attaches by HWND/process ID, retries session creation, captures event logs and artifacts.

Yomi opportunity: create a deterministic UI automation harness with a sample app, UIA snapshots, event logs, screenshots, and replayable failure artifacts.

## Adoption Candidates

| Candidate | Potential | Notes |
|---|---:|---|
| UIA event recorder | high | High debugging and learning value |
| Automation readiness rules | high | Safer target selection |
| Multiple tree view modes | high | Better performance and relevance |
| Focus-order tracking | medium | Useful for keyboard fallback |
| Sample-app regression harness | high | Needed before more automation features |
