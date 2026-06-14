# Capability Coverage Dashboard

Generated: 2026-06-12T19:07:36Z
Capabilities: 44
Verified: 0
Average coverage: 84%

## Priority Queue

1. `ui_set_value` — 0% coverage — Set value (Value pattern) not supported on Notepad Document element
2. `ui_scroll` — 0% coverage — Scroll pattern not available on Notepad Document
3. `window_get_foreground` — 0% coverage — Response format parsing mismatch
4. `screen_monitor_count` — 0% coverage — Test script parsing issue (capability works: returned count=1)
5. `ui_find_toggles` — 0% coverage — Settings tree returned only 1 element (lite mode)
6. `ui_expand_collapse` — 0% coverage — No ExpandCollapse elements found in Settings
7. `media_previous_track` — 0% coverage — JSON-RPC parameter parsing issue
8. `uia_helper_ping` — 100% coverage, low confidence — only 1 test
9. `app_launch_notepad` — 100% coverage, low confidence — only 1 test
10. `window_get_info` — 100% coverage, low confidence — only 1 test

## Detailed Analysis

### Capabilities by Status

**Failing (0% success rate):** 7 capabilities

| Capability | Category | Failure Reason |
|---|---|---|
| ui_set_value | UI Automation | Notepad Document lacks Value pattern; use type_text instead |
| ui_scroll | UI Automation | Notepad Document lacks Scroll pattern; use keyboard fallback |
| window_get_foreground | Window Management | Response field name mismatch (hwnd vs .hwnd) |
| screen_monitor_count | System Administration | Script parsing error — capability actually works (count=1) |
| ui_find_toggles | UI Automation | Settings lite tree too sparse; need full tree enumeration |
| ui_expand_collapse | UI Automation | No expandable elements in current Settings view |
| media_previous_track | Media Control | Likely parameter name mismatch |

**Degraded (< 95% success, > 0%):** 37 capabilities

All passing capabilities are "degraded" because each was tested only once — confidence threshold (0.4) not reached.

### App Coverage

| Application | Capabilities Tested | Pass Rate |
|---|---|---|
| Notepad | 10 | 80% (8/10) |
| Calculator | 3 | 100% (3/3) |
| File Explorer | 3 | 100% (3/3) |
| Settings | 3 | 33% (1/3) |
| Chrome | 3 | 100% (3/3) |
| System (generic) | 12 | 83% (10/12) |
| Media | 3 | 66% (2/3) |

### Infrastructure

| Component | Status | Detail |
|---|---|---|
| UIA helper (C#) | ✅ Working | 147 MB, 50+ RPC methods, JSON-RPC over stdio |
| UIA client (TS) | ✅ Working | Connection, element resolution, error handling |
| Recovery engine | ✅ Implemented | 4-strategy ladder, heartbeat, retry |
| Vision layer | ✅ Implemented | OCR (4 providers), VLM (2 providers) |
| Safety | ✅ Implemented | Blocklist, risk classification, confirmation |
| Strategies | ✅ Implemented | ~/.yomi/strategies/strategies.json (2 strategies learned) |
| Knowledge base | ✅ Implemented | SQLite at ~/.yomi/knowledge.db |
| Capability registry | ✅ Populated | ~/.yomi/capability_registry.json |
| Successful strategies | ⚠️ Empty | ~/.yomi/successful_strategy.json not yet created |

### Test Health

| Metric | Value |
|---|---|
| Unit tests (capability-validation) | 5/5 pass |
| E2E tests (universal-automation) | 3/10 pass (last run) |
| Real capability validations | 37/44 pass (84.1%) |
| Apps tested | 5 |
