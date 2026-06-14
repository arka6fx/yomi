# Failure Analysis Report

Generated: 2026-06-12T19:07:36Z

## Failure 1: ui_set_value on Notepad Document

| Field | Value |
|---|---|
| **Capability** | ui_set_value |
| **App** | Notepad |
| **Evidence Chain** | Attempted `set_value` on Document element → RPC returned error |
| **Root Cause** | The Notepad editor is a `Document` control type, not an `Edit` control. Document controls don't support the `Value` pattern — they only support `Text` and `TextPattern2`. `set_value` requires the `Value` pattern. |
| **Recovery Attempted** | None in this test |
| **Fix** | Use `type_text` for Document controls instead of `set_value`. The existing procedural memory already has this strategy (`type_text` via `set_value` — 55% confidence, and `clipboard_paste` — 65% confidence). |
| **Detection Method** | RPC error response |

## Failure 2: ui_scroll on Notepad Document

| Field | Value |
|---|---|
| **Capability** | ui_scroll |
| **App** | Notepad |
| **Root Cause** | Notepad's Document element doesn't expose the `Scroll` pattern. Scrolling in Notepad is done via keyboard (Page Up/Down) or mouse wheel, not via UIA Scroll pattern. |
| **Fix** | Implement keyboard fallback (PageUp/PageDown) when Scroll pattern is unavailable. The existing `scrollElement` helper already does this. |
| **Detection Method** | RPC error: pattern not supported |

## Failure 3: window_get_foreground

| Field | Value |
|---|---|
| **Capability** | window_get_foreground |
| **Root Cause** | Test script bug — the `Invoke-UiaMethod` returns `{id: ..., result: {hwnd: ...}}` but the script checked `$fgResult.hwnd` instead of `$fgResult.result.hwnd`. |
| **Type** | Test harness issue, not capability issue |
| **Fix** | Correct property path in test script |

## Failure 4: screen_monitor_count

| Field | Value |
|---|---|
| **Capability** | screen_monitor_count |
| **Root Cause** | Test script bug — the script expected a direct number but the RPC returned `{ok: true, count: 1}`. The parsing logic didn't extract `.result.count`. |
| **Type** | Test harness issue, not capability issue |
| **Fix** | Correct response parsing |
| **Actual Result** | monitor_count = 1 ✅ |

## Failure 5: ui_find_toggles in Settings

| Field | Value |
|---|---|
| **Capability** | ui_find_toggles |
| **App** | Settings |
| **Root Cause** | The `get_ui_tree` was called without specifying `view`, defaulting to `control` view with `lite: false` (implicit). The Settings app uses UWP controls that may not expose Toggle pattern in the limited 300-node snapshot. Additionally, the Settings landing page may not have visible toggles without navigating to a subpage. |
| **Fix** | Navigate to a specific settings page (e.g., Accessibility > Visual effects) to find toggles. Or use `content` view. |
| **Detection Method** | Empty result from element filter |

## Failure 6: ui_expand_collapse in Settings

| Field | Value |
|---|---|
| **Capability** | ui_expand_collapse |
| **App** | Settings |
| **Root Cause** | Same as Failure 5 — Settings landing page has no expandable elements without navigation to a specific subpage. |
| **Fix** | Navigate to System > Display or similar page with expandable sections |
| **Detection Method** | Empty result from element filter |

## Failure 7: media_previous_track

| Field | Value |
|---|---|
| **Capability** | media_previous_track |
| **Root Cause** | The `media_key` method expects a key parameter. The test sent `key="previous_track"` but the C# helper may expect a different format (e.g., `key="prev_track"` or a numeric value). |
| **Fix** | Verify the exact parameter format expected by `MediaKey()` in Program.cs |
| **Detection Method** | RPC error response |

## Recovery Attempts Summary

During the validation run, no automated recovery was triggered because the validation script directly invoked RPC methods without the recovery layer. The existing recovery infrastructure (in `recovery.ts`) would handle:

- **Stale element references**: Re-resolve via `matchElement` (automationId → exact name+role → fuzzy name)
- **Focus loss**: Re-acquire via `set_foreground` + ALT-tap fallback
- **Modal dialogs**: Detect and dismiss via `modal-selector.ts`
- **Scroll pattern missing**: Keyboard fallback (already implemented in `scrollElement`)
- **set_value failing**: Clipboard paste fallback (already in procedural memory with 65% confidence)

## Gap Analysis

| Gap | Severity | Evidence |
|---|---|---|
| Notepad Document lacks Value pattern | High | Confirmed failure |
| Notepad Document lacks Scroll pattern | Medium | Keyboard fallback exists |
| Settings requires navigation to find controls | Medium | Need page-aware automation |
| Test scripts need correct response parsing | Low | Test harness issue |
| Single-test confidence too low for "verified" status | Low | Needs repeated test runs |
