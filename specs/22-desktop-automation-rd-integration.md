# Spec 22 - Desktop Automation R&D Integration

## Purpose

Turn the local `DesktopAutomation/` research corpus and the vendored `examples/`
reference tree into a phased implementation program for Yomi's desktop
automation platform.

The objective is not to copy external code. The objective is to extract durable
patterns, score them, implement only high-value capabilities, and validate each
adoption with tests before expanding the automation surface.

## Source References

Local-only research corpus, ignored by git:

- `DesktopAutomation/research_index.json`
- `DesktopAutomation/research_gap_report.md`
- `DesktopAutomation/feature_adoption_scoring.md`
- `DesktopAutomation/continuous_improvement.md`
- `DesktopAutomation/FlaUI/analysis.md`
- `DesktopAutomation/AccessibilityInsights/analysis.md`
- `DesktopAutomation/Playwright/knowledge-index.md`
- `DesktopAutomation/OpenCV/knowledge-index.md`
- `DesktopAutomation/PaddleOCR/knowledge-index.md`
- `DesktopAutomation/BrowserUse/analysis.md`
- `DesktopAutomation/LangGraph/analysis.md`
- `DesktopAutomation/OpenInterpreter/analysis.md`
- `DesktopAutomation/Win32/knowledge-index.md`

Vendored example/reference tree, ignored by git:

- `examples/AGENTS.md` for agent-loop, tool registry, gateway, plugin, skill,
  task delegation, test isolation, and durable workflow patterns.
- `examples/run_agent.py`, `examples/model_tools.py`, `examples/toolsets.py`,
  and `examples/tools/` for high-level agent/tool orchestration patterns.
- `examples/hermes_state.py` and `examples/trajectory_compressor.py` for
  searchable session state and trajectory compression patterns.
- `examples/gateway/` for messaging gateway architecture. These remain hidden
  from public Yomi UI unless Specs 19-20 explicitly re-enable them.

## Locked Decisions

1. `DesktopAutomation/` and `examples/` remain local-only research inputs and
   must not be packaged, deployed, or committed.
2. Research outputs become tracked only when rewritten as Yomi specs, tests,
   or original Yomi implementation.
3. No external code is copied into Yomi.
4. Hidden browser automation and messaging gateway features stay hidden unless
   their specs are explicitly active.
5. Every adopted feature needs unit, integration, regression, and automation
   coverage appropriate to its layer.
6. Small reliability improvements come before larger agent/browser/learning
   features.

## Current Baseline

Yomi already has:

- C# FlaUI/UIA helper with JSON-RPC over stdio.
- UIA tree snapshots, direct children, subtrees, focus tree, text read, pattern
  actions, scroll, right-click, window/process/clipboard/screenshot methods.
- Stale-ref retry via re-snapshot and element re-resolution.
- Safety blocklist, risk classification, and confirmation flow.
- Procedural memory, episodic memory, knowledge graph, automation run logging.
- Vision layer with OCR/VLM provider hooks, but visual grounding is incomplete.
- Browser layer wrapper, but browser automation remains hidden/pending.

## Phase 0 - Corpus & Spec Conversion

Status: done.

Deliverables:

- `DesktopAutomation/` local corpus created and gitignored.
- Research index, gap report, scoring rubric, and continuous workflow created.
- This spec created to make the adoption plan tracked.

Validation:

- `git check-ignore -v DesktopAutomation/research_index.json`
- `git check-ignore -v DesktopAutomation/FlaUI/repo/README.md`

## Phase 1 - UIA Reliability & Actionability

Status: done.

Source patterns:

- FlaUI: typed COM errors, retry results, `ScrollItemPattern`, clickable point
  fallback, `SendMessageTimeout(WM_NULL)` responsiveness checks.
- Playwright: actionability checks before action.
- Accessibility Insights: pattern-first action invocation and readiness rules.
- Win32: reliable foreground, `WaitForInputIdle`, hit-testing.

Implemented:

- Typed UIA helper errors with sidecar `UiaRpcError`.
- Typed stale-element detection while preserving legacy message fallback.
- `scroll_into_view` RPC via `ScrollItemPattern`.
- Pre-action disabled-element, invalid-rectangle, and unscrollable-offscreen
  failures with structured codes/hints.
- Pre-action blocked-app and foreground-changed refusal before acting on stale
  window context.
- `get_ui_tree` `view: "control" | "content" | "raw"`.
- No-actionable-pattern failures for semantic UIA actions.
- UIA helper responsiveness probe using `SendMessageTimeout(WM_NULL)`.
- `WaitForInputIdle` helper RPC and launch-path idle/responsiveness probing.
- Stale retry telemetry with attempted refs and recovered refs.

Remaining tasks:

- None.

Tests:

- Unit tests for actionability rules and typed errors.
- Helper build validation.
- Regression tests for disabled/offscreen/stale refs.

## Phase 2 - Smart Tree & Perception

Status: done.

Source patterns:

- FlaUI and Accessibility Insights: raw/control/content tree views.
- PaddleOCR: region OCR, OCR caching, text grounding.
- OpenCV: screen diffs, template matching, multi-scale matching.
- Browser Use: DOM/screenshot dual grounding.

Implemented:

- `get_ui_tree` supports control/content/raw views.
- Region OCR result cache keyed by screenshot hash plus normalized region.
- OCR result normalization for plain text and boxed word results.
- Byte-level screen diff helper for before/after validation.
- Before/after screen capture diff wrapper for action validation.
- Opt-in visual text grounding from OCR boxes to screen coordinates, with nearest
  UIA element linking when a snapshot is provided.
- Visual grounding safety gate refuses blocklisted apps and does not fabricate a
  full-screen target on misses.
- Regression coverage proving visual grounding is opt-in and blocklisted apps
  are rejected before screen capture.
- UIA action recovery can use visual text grounding after failed click-like
  actions (`invoke_element`, `click_element`, `right_click`) only.

Remaining tasks:

- None for CI-safe implementation. Windows fixture/e2e coverage for visual
  fallback clicks is registered in the deterministic harness and gated behind
  `YOMI_RUN_WINDOWS_AUTOMATION_E2E=true`.

Tests:

- Unit tests for cache keys, OCR result normalization, screen diff, and OCR text
  grounding.
- Fixture-style tests for OCR boxes mapped into screen coordinates.
- Regression tests proving visual fallback is opt-in and not used for
  blocklisted apps.

## Phase 3 - Event Recorder & Failure Artifacts

Status: done.

Source patterns:

- Accessibility Insights: event recording for focus, structure, property,
  selection, invoke, and tab-stop traversal.
- Open Interpreter: typed event streams and replayable process logs.
- examples: searchable session state and trajectory compression.

Deliverables:

- UIA event recorder mode in helper/sidecar.
- Failure artifacts: UIA snapshot, focused tree, screenshot, action request,
  typed error, retry attempts, and recovery result.
- Debug stream separated from user-facing stream.

Implemented:

- Sidecar `UiaEventRecorder` records focus and synthetic typed automation
  events with stable JSON serialization.
- Failure artifact writer stores action, typed error, retry attempts, recovery,
  UIA snapshot, focus tree, and screenshot under the OS temp directory.
- Artifact/debug files are separate from user-facing SSE events.

Tests:

- Unit tests for event serialization.
- Integration tests with synthetic event frames.
- Automation test that records focus changes in a sample app.

## Phase 4 - Deterministic Automation Test Harness

Status: done.

Source patterns:

- Accessibility Insights: sample app, WinAppDriver-style harness, event logs,
  screenshots, and `.a11ytest` artifacts.
- examples: hermetic test isolation and subprocess-per-test philosophy.

Deliverables:

- Stable sample target app or fixture windows for UIA regression testing.
- Artifact folder per automation run under a temp directory, not user home.
- Regression scenarios: stale refs, modal dialogs, offscreen elements,
  disabled controls, large trees, blocklisted windows, and focus loss.

Implemented:

- Regression scenario registry covers stale refs, modal dialogs, offscreen
  elements, disabled controls, large trees, blocklisted windows, and focus loss.
- Artifact folders are created under `os.tmpdir()` via
  `yomi-automation-artifacts`.
- Windows-only e2e runs are gated by `YOMI_RUN_WINDOWS_AUTOMATION_E2E=true`.

Tests:

- CI-safe unit/integration tests.
- Windows-only e2e tests gated behind an explicit environment flag.

## Phase 5 - Graph Recovery & Approvals

Status: done.

Source patterns:

- LangGraph: resumable interrupts, node error handlers, idle timeout,
  deterministic task IDs, parallel fan-out/fan-in.
- Open Interpreter: allow/prompt/forbidden policy, approval cache, tool
  mutation metadata.
- examples: delegation and iteration budgets.

Deliverables:

- Resumable approval IDs for destructive actions.
- Node-level recovery handlers for UIA action failures.
- Heartbeat/idle timeout around long automation nodes.
- Tool mutation metadata used by risk classification.

Implemented:

- Deterministic approval cache keys and resumable approval IDs.
- Exact approved destructive actions are cached to avoid repeated prompts.
- Recovery utilities expose deterministic task IDs and heartbeat/idle timeout
  wrapping for long automation nodes.
- Tool mutation metadata feeds risk classification.

Tests:

- Unit tests for approval policy and cache keys.
- Integration tests for interrupt/resume.
- Regression tests for no repeated prompts after exact approval.

## Phase 6 - Browser & Messaging Extensions

Status: gated / enforced.

Source patterns:

- Playwright: auto-waiting, selector priority, actionability, tracing.
- Browser Use: browser agent loop, DOM extraction, screenshot grounding.
- Hermes/examples gateway: platform adapters, command registry, plugin/toolset
  boundaries.

Rules:

- Browser automation remains hidden until Spec 17 is explicitly active.
- Messaging gateway remains hidden until Specs 19-20 are explicitly active.
- Any implementation must go through proposals and tests first.

Implemented:

- Browser layer remains optional/hidden and no longer requires Playwright types
  during normal sidecar validation.
- Messaging tools remain stubbed and are removed from the active harness tool
  registry until Specs 19-20 explicitly activate them.

## Adoption Scoring

Every candidate gets scored before implementation:

- usefulness
- complexity
- maintenance cost
- performance impact
- security impact
- compatibility

Use `DesktopAutomation/feature_adoption_scoring.md` as the rubric.

## Continuous Workflow

On each major desktop automation cycle:

1. Refresh or inspect `DesktopAutomation/research_index.json`.
2. Compare current Yomi behavior against `research_gap_report.md`.
3. Pick only high-value candidates from the current phase.
4. Write or update spec notes before implementation.
5. Implement the smallest correct change.
6. Add tests and artifacts.
7. Update the spec status.

## Verification Commands

Targeted commands used during this spec:

```bash
bun test apps/sidecar/src/tools/act-helpers.test.ts apps/sidecar/src/uia/vision-layer.test.ts apps/sidecar/src/uia/event-recorder.test.ts apps/sidecar/src/uia/failure-artifacts.test.ts apps/sidecar/src/uia/automation-harness.test.ts apps/sidecar/src/uia/act-bus.test.ts apps/sidecar/src/uia/recovery.test.ts apps/sidecar/src/uia/safety.test.ts
bunx eslint src/tools/act-helpers.ts src/tools/act-helpers.test.ts src/tools/system.ts src/tools/uia-advanced.ts src/uia/client.ts src/uia/vision-layer.ts src/uia/vision-layer.test.ts src/uia/event-recorder.ts src/uia/event-recorder.test.ts src/uia/failure-artifacts.ts src/uia/failure-artifacts.test.ts src/uia/automation-harness.ts src/uia/automation-harness.test.ts src/uia/act-bus.ts src/uia/act-bus.test.ts src/uia/recovery.ts src/uia/recovery.test.ts src/uia/safety.ts src/uia/safety.test.ts src/uia/browser-layer.ts src/harness/tools.ts
dotnet build apps/uia-helper
```

Full repo validation is still blocked by unrelated existing sidecar typecheck
strict-null errors in older UIA e2e/test/support files. The hidden browser layer
is now dependency-optional, so missing `playwright` types no longer block normal
sidecar validation.
