# Spec 21 — Universal Desktop Automation (Action Patterns + Smart Tree)

## Purpose

Spec 16 established the UIA foundation — a C# helper with 20 JSON-RPC methods
exposing Invoke, Value, Toggle, RangeValue, SelectionItem, ScrollItem, and
LegacyIAccessible patterns. That covered the **base action surface** but left
three gaps that made the agent blind to real desktop apps:

1. **Missing UIA patterns** — ExpandCollapse, Scroll, Text, and Selection
   patterns were unreachable, so tree views, dropdowns, scrollable panes, and
   rich text controls were invisible to the agent.
2. **Truncation blindness** — The tree capped at 400 nodes / depth 40 with no
   signal that it was cut off, so the agent couldn't tell it was missing UI.
3. **No smart navigation** — The agent could only dump the whole tree (slow,
   wasteful) or do nothing; there was no incremental exploration (get children
   of a container, inspect the focused element, scroll into view).

This spec fills all three gaps across four phases. All four phases are implemented.

## Locked Decisions

1. **All new patterns go in the C# helper**, not in TypeScript. FlaUI gives
   direct access to every UIA pattern. No Bun addon or PowerShell fallback.
2. **Read-only tools skip the safety pipeline** (blocklist only). get_subtree,
   find_element, get_text, get_children, get_focus_tree are harmless to the
   system.
3. **Right-click → context menu is a two-step flow**: right_click returns the
   click coordinates, then the agent calls get_ui_tree to discover the context
   menu that appeared. No special context-menu capture.
4. **Tree truncation is explicit** via a `truncated: boolean` field on every
   `get_ui_tree` response. The agent checks this before deciding the tree is
   complete.
5. **`childCount` on each element** tells the agent which nodes are expandable
   without an extra COM call.

## New RPC Surface

Phase 1 added 8 new JSON-RPC methods to the C# helper; Phase 2 added 2 more.
All follow the same line-delimited JSON protocol as Spec 16.

| Method | Phase | Parameters | Returns | Pattern |
|---|---|---|---|---|
| `expand_element` | 1 | ref | ok, name | ExpandCollapse.Expand |
| `collapse_element` | 1 | ref | ok, name | ExpandCollapse.Collapse |
| `scroll` | 1 | ref, horizontalPercent?, verticalPercent? | ok, name | Scroll.SetScrollPercent |
| `right_click` | 1 | ref | ok, x, y | Mouse right button (cursor move + mouse_event) |
| `get_subtree` | 1 | ref, maxNodes?, maxDepth? | elements, count | Recursive tree walk (uses existing Describe) |
| `find_element` | 1 | ref, role?, name?, automationId? | ok, element, visited | Tree walk + property matching |
| `get_text` | 1 | ref | ok, text, length, name | TextPattern.DocumentRange.GetText |
| `get_children` | 2 | ref, maxChildren? | elements, count | Direct children only (depth 1) |
| `get_focus_tree` | 2 | maxDepth? | ok, elements, focusRef | Focused element + ancestor chain |

Each element returned by these methods now includes `childCount` (number of
direct children), so the agent can decide which nodes to drill into.

## Phase 1: Extended Action Patterns (done)

### Expand / Collapse

Expand and collapse tree nodes, dropdown sections, and accordion panels via the
ExpandCollapse UIA pattern. Critical for navigating Settings, file trees, Office
ribbons, and any collapsed UI.

```
expand_element({ ref }) → { ok: true, name: "Navigation pane" }
collapse_element({ ref }) → { ok: true, name: "Navigation pane" }
```

After expanding, the agent must call `get_ui_tree` (or `get_subtree`) to
discover newly revealed children. The `childCount` field on the parent tells the
agent whether children are hidden before it tries to expand.

### Scroll

Scroll a container (list, tree, pane, document) to an absolute percentage via
the Scroll UIA pattern. Pass `-1` to leave an axis unchanged.

```
scroll({ ref, verticalPercent: 50 }) → scrolls to vertical midpoint
scroll({ ref, horizontalPercent: 0 }) → scrolls to left edge
```

All major scrollable controls (List, Tree, Pane, Document, ScrollBar) support
ScrollPattern. The agent can scroll a container, then snapshot again to see
newly visible elements.

### Right-click

Right-click at the center of an element to open its context menu. Uses
Win32 `SetCursorPos` + `mouse_event` (same mechanism as the existing
`click_point` method). Yields for 200ms to let the menu render.

```
right_click({ ref: "w1e5" }) → { ok: true, x: 840, y: 520 }
// agent calls get_ui_tree to discover the context menu
```

### Text Read

Read the full text content of a TextPattern-enabled control (document, editor,
terminal, rich text box). Uses `DocumentRange.GetText(-1)` which returns the
entire content.

```
get_text({ ref: "w1e12" }) → { ok: true, text: "Hello world\nLine 2", length: 20 }
```

Useful for reading terminal output, editor content, or any text-heavy UI the
LLM needs to reason about.

### Find Element

Search descendants of a UI element by role, name, and/or automationId. Returns
the first match with a stable ref. Uses a capped tree walk (max 200 nodes, depth
20) for safety.

```
find_element({ ref: "w1e1", role: "Button", name: "Save" })
  → { ok: true, element: { ref: "f1", name: "Save", role: "Button", ... }, visited: 42 }
```

### Subtree Snapshot

Walk the full subtree under a specific element with independent node/depth
limits. Use this to explore containers that were truncated in the top-level
snapshot. Each element includes `childCount`.

## Phase 2: Smart Tree Exploration (done)

### Truncation Awareness

`get_ui_tree` now returns `truncated: true` when the walk hit node or depth
limits. Every element also carries `childCount`. Together these let the agent
reason: "the tree says truncated, and this TreeItem has 12 children but only 3
are shown — I should expand it and call get_subtree."

```typescript
// UiaSnapshot now includes:
interface UiaSnapshot {
  window: string
  elements: UiaElement[]
  truncated?: boolean
}

// UiaElement now includes:
interface UiaElement {
  // ... existing fields ...
  childCount?: number  // 0 = leaf, omitted = unknown
}
```

### get_children — Lightweight Container Peek

Fetches only direct children (depth 1) of a container. Each child includes its
own `childCount` so the agent knows which grandchild containers are expandable.
Much cheaper than `get_subtree` for browsing.

```
get_children({ ref: "w1e10" })
  → { elements: [{ ref: "c1e1", childCount: 0, ... }, { ref: "c1e2", childCount: 5, ... }], count: 2 }
```

### get_focus_tree — Focus-Relative Snapshot

Returns the currently focused element and its ancestors up to the window. Lets
the agent understand context around where the user is working without a full
tree dump. Returns `focusRef` for follow-up actions.

```
get_focus_tree() → {
  ok: true,
  elements: [
    { ref: "z1a1", role: "Edit", name: "Search", ... },   // focused
    { ref: "z1a2", role: "Pane", ... },                    // parent
    { ref: "z1a3", role: "Window", name: "Settings", ... } // window
  ],
  focusRef: "z1a1"
}
```

### Refs and Collision Safety

Refs from all Phase 1–2 methods are stored in the same `_refs` dictionary in
the C# helper, so any action method (invoke, toggle, expand, right-click, etc.)
works against elements from any snapshot method. Each method uses a unique ref
prefix to avoid collisions:

| Method | Ref format | Example |
|---|---|---|
| get_ui_tree | `w{windowSeq}e{seq}` | `w1e42` |
| get_subtree | `r{subReqSeq}n{seq}` | `r1n5` |
| find_element | `f{subReqSeq}` | `f3` |
| get_children | `c{subReqSeq}e{seq}` | `c1e3` |
| get_focus_tree | `z{subReqSeq}a{seq}` | `z1a1` |

Calling `get_ui_tree` clears `_refs` completely (all prior refs become stale).
This is intentional — UI trees mutate between actions.

### Safety Integration

The safety pipeline classifies all new action kinds:

| Kind | Risk | Why |
|---|---|---|
| `expand`, `collapse` | safe | Tree navigation only |
| `scroll` | safe | Viewport change only |
| `right_click` | label-dependent | Risky only if target label is destructive (delete, format, etc.) |
| `get_subtree`, `get_children`, `find_element`, `get_text` | read-only | No safety pipeline (blocklist only) |
| `get_focus_tree` | read-only | No safety pipeline (blocklist only) |

## Phase 3: ReAct Integration (done)

### Tool Discovery

The agent should know which tools to call based on tree state:

- If `truncated === true`, the agent should expand large containers and
  `get_subtree` the most promising node
- If `childCount > 0` on a node and the agent needs to find a specific control,
  it should call `get_children` instead of walking the full subtree
- After any mutation (expand, collapse, scroll, invoke), the agent should
  snapshot again to verify

### Automatic Post-Action Snapshot

After `expand_element`, `collapse_element`, `scroll`, or `right_click`,
the harness automatically calls `get_ui_tree` and returns the new snapshot
alongside the action result. This saves the agent one round-trip.

### Stale-Ref Retry Loop

The existing `attemptAct` / `reResolve` mechanism retries once. Expand this
to a loop: after a mutation, re-snapshot, match the target element by
automationId → name → role, and retry up to N times. The agent should never
see "element no longer available".

### Focus Chain Integration

When the agent starts a multi-step task, it should:
1. Call `get_focus_tree` to understand context
2. Call `get_ui_tree` on the focused window for the full tree
3. As it works through the UI, use `get_children` to incrementally explore
4. If the focus changes unexpectedly, re-call `get_focus_tree` to reorient

## Phase 4: Tree Strategy (done)

### Smart Snapshot (strategy, no code change)

Instead of always grabbing the full foreground window tree (expensive, often
exceeds 400 nodes), the agent prompt now instructs the agent to:
1. Snapshot focused element + immediate context (get_focus_tree)
2. Expand only relevant containers (get_children → pick → expand → repeat)
3. Fetch full tree only when the task requires global awareness
4. Check the `truncated` flag and `childCount` to decide if deeper exploration
   is needed

### Tree Diff

When the agent calls `get_ui_tree` and a previous snapshot exists, the sidecar
automatically computes a `TreeDiff { added, removed, changed }` by matching
elements across snapshots (priority: automationId → exact name+role → fuzzy
name+role). Changed elements are those whose `enabled` or `value` properties
differ. The diff is embedded in `UiaSnapshot.diff` and also formatted as a
human-readable `<tree_diff>` block in the PostToolUse hook (`hooks.ts`).

```
get_ui_tree() → {
  window: "Settings",
  elements: [...],
  diff: {
    added: [{ role: "Button", name: "Save", enabled: true, ... }],
    removed: [{ role: "Button", name: "Cancel", ... }],
    changed: [{ role: "Button", name: "Apply", enabled: true, ... }]
  }
}
```

The PostToolUse hook prepends a compact summary so the LLM immediately sees
"3 element(s) added; 1 element(s) changed (enabled/value)" without scanning
the full tree.

### Focus Tracking

The C# helper polls `GetForegroundWindow()` on a 500ms timer and emits
focus-change event frames over stdout when the foreground window changes:

```
{ "event": "focus_changed", "hwnd": 123456, "window": "Calculator" }
```

The TypeScript client (`client.ts`) detects these event frames (JSON lines
with no `id` field but an `event` field) and dispatches them to a registered
`onFocusChange` callback. The harness (`hooks.ts`) registers the callback,
stores the latest focus event, and surfaces it via `getDesktopFocusContext()`.
This function is called when building the agent prompt, injecting a
`<desktop_focus>` block when the user switched apps mid-task.

## Files

| File | Phase | Role |
|---|---|---|
| `packages/shared/src/index.ts` | 1, 2 | UiaAction variants, UiaElement.childCount, UiaSnapshot.truncated |
| `apps/uia-helper/Program.cs` | 1, 2 | New RPC methods, childCount reporting, truncated flag |
| `apps/sidecar/src/uia/client.ts` | 1, 2 | Typed client methods for all new RPCs |
| `apps/sidecar/src/tools/uia-advanced.ts` | 1, 2 | LLM-facing tool definitions |
| `apps/sidecar/src/tools/index.ts` | 1 | Wire createUiaAdvancedTools |
| `apps/sidecar/src/uia/safety.ts` | 1 | classifyRisk widened to new action kinds |
| `apps/sidecar/src/tools/system.ts` | 3 | Auto-post-action snapshot hook |
| `apps/sidecar/src/uia/client.ts` | 3 | Re-snapshot + retry loop |
| `packages/shared/src/index.ts` | 4 | TreeDiff, FocusChangeEvent types |
| `apps/uia-helper/Program.cs` | 4 | Focus-change polling timer, GetWindowText/GetWindowTextLength P/Invoke |
| `apps/sidecar/src/uia/client.ts` | 4 | computeDiff(), previousElements tracker, onFocusChange callback, event frame handling |
| `apps/sidecar/src/harness/hooks.ts` | 4 | PostToolUse tree-diff formatting, focus handler registration, getDesktopFocusContext() |
| `apps/sidecar/src/harness/prompt.ts` | 4 | desktopFocusChange in PromptContext, focus block in buildAgentPrompt |
| `apps/sidecar/src/graph/prompts.ts` | 4 | Wired getDesktopFocusContext() into buildGraphSystemPrompt |
| `apps/sidecar/src/pipeline/agent.ts` | 4 | Wired getDesktopFocusContext() into getAgentPrompt |
