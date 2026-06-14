# Desktop Automation Research Gap Report

Generated: 2026-06-12

## Current Yomi Capabilities

- UIA helper with tree enumeration, element lookup, pattern actions, mouse, keyboard, window management, screenshots, process control, clipboard, and audio.
- Recovery ladder: re-resolve, refocus, rescan, replan.
- Safety blocklist, risk classification, and confirmation events.
- Vision layer with OCR/VLM providers, but visual grounding is still a stub.
- Playwright browser layer exists, but MCP/browser agent integration is not fully enabled.
- Procedural memory, episodic memory, knowledge graph, automation run persistence, and plugin system exist.
- App-specific automation exists for Spotify, WhatsApp, Notepad, and Chrome.

## High Priority Gaps

| Gap | Source Pattern | Current State | Opportunity |
|---|---|---|---|
| Scroll into view | Microsoft UIA / FlaUI `ScrollItemPattern` | Elements can be offscreen without automatic scroll-to-target | Add `scrollIntoView(ref)` and call before click/type when `offscreen=true` |
| UIA cache requests | FlaUI `CacheRequest` | Tree walking likely incurs repeated property reads | Batch core properties and patterns during snapshot generation |
| UIA event recorder | Accessibility Insights event mode | Yomi mostly polls snapshots | Add optional event subscription/logging for focus, structure, property, invoke, selection |
| Actionability checks | Playwright auto-wait | Yomi retries stale refs but lacks full visibility/stability/obscured checks | Add pre-action checks: visible, enabled, stable rect, foreground process, not blocked |
| Typed COM errors | FlaUI `Com.Call` | Error handling may depend on message strings/HRESULTs | Map UIA HRESULTs to typed errors in C# helper |
| UI automation test harness | Accessibility Insights UITests | Existing e2e logs exist, but deterministic UIA sample harness is incomplete | Add sample app + snapshot/event/screenshot artifacts |
| Real visual grounding | OpenCV / PaddleOCR / Browser Use | `findVisualElement` returns full screen | Implement OCR/text grounding and template-match fallback |
| Browser agent integration | Playwright / Browser Use | Browser layer exists, MCP bridge hidden/commented | Add browser automation only after Spec 17 approval, with recovery/tracing |

## Medium Priority Gaps

| Gap | Source Pattern | Opportunity |
|---|---|---|
| Multiple UIA tree views | FlaUI / Accessibility Insights | Add raw/control/content modes to `get_ui_tree` |
| `WaitForInputIdle` | Win32 / FlaUI Application | Wait after launching apps before UIA scan/action |
| `SendMessageTimeout(WM_NULL)` | FlaUI Wait | Detect frozen apps before retries |
| Approval policy modes | Open Interpreter | Support allow/prompt/forbidden and cached approvals by exact action |
| Idle timeout heartbeat | LangGraph | Detect hung node/tool calls |
| Deterministic task IDs | LangGraph | Improve replay and cache stability |
| OCR cache | PaddleOCR | Hash screenshots/regions to avoid repeated OCR |
| Region-based OCR | PaddleOCR | OCR only relevant screenshot regions |

## Low Priority / Defer

| Gap | Reason |
|---|---|
| Guardian-style model approval review | Adds latency/cost and policy complexity |
| Full Playwright tracing clone | Valuable but heavy; Yomi timeline can be smaller |
| Layout analysis via PP-Structure | More document-focused than desktop UI-focused |
| Stealth/browser bot avoidance | Not core to Yomi automation and may create risk |

## Recommended Adoption Order

1. Add typed UIA errors and structured retry results.
2. Add actionability checks and `scrollIntoView`.
3. Add UIA event recorder and failure artifacts.
4. Add deterministic UI automation test harness.
5. Add OCR cache and region OCR.
6. Implement real visual grounding after test harness exists.
7. Integrate browser automation after hidden-feature/spec approval.

## Validation Requirements

Every adopted feature must include:

- Unit tests for scoring, parsing, retry, or policy logic.
- Integration tests against the UIA helper or browser layer.
- Regression tests covering stale refs, disabled/offscreen elements, modal dialogs, and blocked apps.
- Automation tests with saved screenshots, UIA snapshots, and event logs.
