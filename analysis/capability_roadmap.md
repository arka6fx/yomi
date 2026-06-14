# Prioritized Roadmap — Top 20 Improvements

Generated: 2026-06-12T19:07:36Z
Based on: Measured failures from real capability validation + research gap analysis

## Tier 1: Critical (fix known failures — P0)

### 1. Use Keyboard Fallback for Document Scroll
- **Measured failure**: `ui_scroll` 0% success on Notepad
- **Fix**: When Scroll pattern unavailable, use PageDown/PageUp keyboard keys
- **Files**: `apps/sidecar/src/uia/act-executor.ts` (scroll validation) or `scrollElement` helper
- **Impact**: Fixes a known failing capability with minimal code

### 2. Use type_text as Fallback for set_value
- **Measured failure**: `ui_set_value` 0% success on Document elements
- **Fix**: In `act-executor.ts` or `act-helpers.ts`, when `set_value` fails on a Document element, fall back to `type_text`
- **Files**: `apps/sidecar/src/tools/act-helpers.ts` (attemptAct)
- **Impact**: Fixes a known failing capability; already partially covered by procedural memory

### 3. Fix media_previous_track Parameter
- **Measured failure**: `media_previous_track` 0% success
- **Fix**: Check the exact parameter format expected by `MediaKey()` in Program.cs and fix parameter name
- **Files**: `apps/uia-helper/Program.cs` or test script
- **Impact**: Fixes a media control capability gap

## Tier 2: High (enable reliable browser automation — P0)

### 4. Enable Playwright Provider
- **Gap**: `browser-layer.ts` gated behind `YOMI_BROWSER_PROVIDER=playwright` env var
- **Fix**: Set env var, verify Playwright can launch and control Chrome/Edge
- **Files**: `apps/sidecar/src/uia/browser-layer.ts`, desktop env config
- **Impact**: Enables full browser automation (navigate, click, fill, extract, screenshot)
- **Dependency**: Ensure `playwright` npm package is installed

### 5. Complete MCP Browser Client
- **Gap**: `mcp/client.ts` mostly commented out
- **Fix**: Uncomment and activate `experimental_createMCPClient` with `@playwright/mcp`
- **Files**: `apps/sidecar/src/mcp/client.ts`
- **Impact**: Adds 12+ browser tools with proper safety wrapping

### 6. Route Browser Tasks Away from UIA
- **Gap**: Current prompt attempts UIA for everything, including browser content
- **Fix**: Update harness prompt to route URL-based tasks to browser tools
- **Files**: `apps/sidecar/src/harness/prompt.ts`
- **Impact**: Prevents unreliable UIA-based browser interaction

## Tier 3: High (performance — P1)

### 7. Implement UIA CacheRequest
- **Gap**: Each element's properties fetched individually (9+ COM calls per node)
- **Fix**: Add `CacheRequest` scope in C# helper to batch property reads
- **Files**: `apps/uia-helper/Program.cs`
- **Research**: FlaUI analysis.md pattern #4
- **Impact**: 10-50x tree enumeration speedup; all UIA capabilities benefit

### 8. Add Lite Mode to All Tree Queries
- **Observation**: `lite:true` already exists and provides ~3x speedup
- **Fix**: Default to lite mode unless full patterns explicitly needed
- **Files**: `apps/uia-helper/Program.cs`, `apps/sidecar/src/uia/client.ts`
- **Impact**: Faster tree enumeration on large apps (Spotify: ~800 nodes → 3x faster)

## Tier 4: High (validation infrastructure — P1)

### 9. Add ScrollIntoView Support
- **Gap**: `ScrollItemPattern.ScrollIntoView()` not exposed
- **Fix**: Add RPC method `scroll_into_view` that invokes UIA ScrollItem pattern
- **Files**: `apps/uia-helper/Program.cs`, `apps/sidecar/src/tools/uia-advanced.ts`
- **Research**: FlaUI pattern
- **Impact**: Many offscreen elements become reachable

### 10. Build Repeated Validation Suite
- **Gap**: All capabilities tested only once → confidence too low for "verified" status
- **Fix**: Run validation 5-10x per capability, record pass rates
- **Script**: Extend `run-validation.ps1` with iteration count
- **Impact**: Enables "verified" status for stable capabilities (requires 5+ tests with ≥95% pass)

## Tier 5: Medium (coverage expansion — P1)

### 11. Expand App Test Coverage
- **Gap**: Only 5 apps tested (Notepad, Calculator, Explorer, Settings, Chrome)
- **Fix**: Add tests for: Edge, Spotify, WhatsApp, Telegram, Discord, VLC, Office (Word/Excel), PowerToys
- **Evidence**: 13+ automation-relevant apps installed and untested

### 12. Build Office Application Profiles
- **Gap**: Word, Excel, PowerPoint installed but zero capabilities tested
- **Fix**: Create profiles for Word (document editing), Excel (spreadsheet), PowerPoint (presentation)
- **Files**: `profiles/word.profile.json`, `profiles/excel.profile.json`, `profiles/powerpoint.profile.json`

### 13. Test Spotify End-to-End
- **Gap**: Spotify installed as Store app but not validated
- **Fix**: Launch Spotify, search for a track, verify playback state changes, control volume
- **Impact**: Validates 5 media-related capabilities (play_pause, next/prev track, volume, search_play)

### 14. Test WhatsApp Desktop
- **Gap**: WhatsApp installed as Store app, `sendWhatsAppMessage` tool exists but unvalidated
- **Fix**: Launch WhatsApp, verify QR code/login state, attempt message sending flow
- **Impact**: Validates messaging capability (hidden feature)

## Tier 6: Medium (vision — P2)

### 15. Install and Test Tesseract OCR
- **Gap**: OCR provider not installed; all 4 OCR providers untested
- **Fix**: Install Tesseract via `choco install tesseract`, test text extraction on known screen region
- **Impact**: Enables OCR text extraction — fallback when UIA can't read text

### 16. Add Visual Validation to Capability Tests
- **Gap**: No test captures screenshot evidence during capability validation
- **Fix**: Add `capture_screen` before/after to every capability test for screenshot evidence
- **Impact**: Enables screenshot-based evidence (strongest evidence kind)

### 17. Test VLM Screen Analysis
- **Gap**: VLM provider (OpenAI/Anthropic) not tested with actual screenshot
- **Fix**: Test `look_at_screen` tool with VLM provider, verify screen description quality
- **Impact**: Validates AI-powered screen understanding

## Tier 7: Medium (recovery infrastructure — P2)

### 18. Add Actionability Checks (visibility + stability)
- **Gap**: Current checks: enabled + not_offscreen + bounding_rect. Missing: visibility check, stability check (not animating), not obscured check
- **Fix**: Add `visible`, `stable`, `not_obscured` to actionability checks in `act-helpers.ts`
- **Files**: `apps/sidecar/src/tools/act-helpers.ts`
- **Research**: Playwright actionability pattern
- **Impact**: Reduces false "success" on elements that exist but aren't actionable

### 19. Automate Strategy Repair Loop
- **Measured failure**: 7 failing capabilities from validation
- **Fix**: When capability fails, automatically: (1) analyze root cause, (2) query procedural memory, (3) apply known fix, (4) re-run validation, (5) record new strategy
- **Files**: Leverage existing `recordFailure()` and `recallBestStrategy()` in `procedural-memory.ts`
- **Impact**: Self-healing capability — platform becomes more reliable over time

## Tier 8: Low (enhancements — P3)

### 20. Interpolated Mouse Movement
- **Gap**: Current cursor teleports via SetCursorPos
- **Fix**: Animate cursor movement across intermediate points (human-like)
- **Files**: `apps/uia-helper/Program.cs`
- **Research**: FlaUI interpolated mouse movement pattern
- **Impact**: Some apps detect teleport movement and ignore it; smooth movement more reliable

## Summary

| Tier | Items | Impact | Effort |
|---|---|---|---|
| Critical (P0) | 3 | Fix known failures | Hours |
| High - browser (P0) | 3 | Enable full browser automation | Days |
| High - perf (P1) | 2 | 10-50x faster tree enumeration | Days |
| High - infra (P1) | 2 | Scroll into view, multi-pass testing | Days |
| Medium - coverage (P1) | 4 | Test more apps | Days |
| Medium - vision (P2) | 3 | OCR + screenshot evidence | Days |
| Medium - recovery (P2) | 2 | Actionability checks, auto-repair | Days |
| Low (P3) | 1 | Smooth mouse movement | Hours |

**Total estimated effort**: 2-3 weeks for P0-P1 items, 4-6 weeks for all 20 items
