# Browser Gap Report

Generated: 2026-06-12T19:07:36Z

## Current Browser Capabilities

| Capability | Status | Implementation |
|---|---|---|
| UIA-based Chrome control | ✅ Working | Find window, get tree, find address bar |
| Playwright integration | ⚠️ Gated | `browser-layer.ts` guarded by `YOMI_BROWSER_PROVIDER=playwright` |
| Playwright MCP | ⚠️ Commented out | `mcp/client.ts` returns empty tools |
| openUserChrome tool | ✅ Working | Launches Chrome with URL from filesystem |

## UIA vs Playwright Comparison

| Dimension | UIA on Chrome | Playwright |
|---|---|---|
| **Reliability** | Medium — Chrome uses custom-drawn controls, WebView2, and dynamically mutating DOM. UIA tree often incomplete or stale. | High — Native browser automation protocol |
| **Speed** | Slow — Tree enumeration across COM bridge (300ms+ for full tree) | Fast — Direct CDP connection |
| **Recovery** | Complex — Stale refs, focus loss, modal detection | Built-in — Auto-waiting, selector retry |
| **Fidelity** | Low — Cannot read actual web page content via UIA | High — Full DOM access, execute JavaScript |
| **Form filling** | Unreliable — Must find Edit elements in tree | Reliable — `page.fill()` with CSS selectors |
| **Screenshot** | Screen-level only via GDI BitBlt | Full page screenshots, element screenshots |
| **File download** | Not supported via UIA | Built-in download handling |
| **Multiple tabs** | Manual via find_window | Built-in page/tab management |

## Test Results

| Test | Result | Detail |
|---|---|---|
| Find Chrome window | ✅ PASS | hwnd found successfully |
| Get Chrome UI tree | ✅ PASS | 77 elements enumerated |
| Find address bar | ✅ PASS | Address bar (Edit/ComboBox) found |

## Gaps Identified

### Gap 1: Playwright Not Enabled

| Field | Detail |
|---|---|
| **Description** | `browser-layer.ts` is gated behind `YOMI_BROWSER_PROVIDER=playwright` which is not set |
| **Impact** | All browser interaction goes through UIA (slow, unreliable for web content) |
| **Fix** | Enable Playwright provider: set `YOMI_BROWSER_PROVIDER=playwright` |
| **Priority** | High |

### Gap 2: Playwright MCP Integration Incomplete

| Field | Detail |
|---|---|
| **Description** | `mcp/client.ts` is mostly commented out. MCP client for `@playwright/mcp` never activated. |
| **Impact** | Cannot use Playwright's 12+ browser tools (navigate, click, type, snapshot, etc.) |
| **Fix** | Complete MCP client implementation per spec 17 |
| **Priority** | High |

### Gap 3: No Browser Automation Validation

| Field | Detail |
|---|---|
| **Description** | The validation script only tested finding Chrome via UIA, not actual browser automation |
| **Impact** | Real browser task performance (navigation, form fill, extraction) unverified |
| **Fix** | Add Playwright-based browser tests to validation suite |

### Gap 4: Edge Browser Not Tested

| Field | Detail |
|---|---|
| **Description** | Edge is installed but was not tested during validation |
| **Impact** | Edge-specific automation issues unknown |
| **Fix** | Add Edge to browser validation tests |

## Recommendations

1. **Enable Playwright provider** — Set `YOMI_BROWSER_PROVIDER=playwright` for reliable browser automation
2. **Complete MCP client** — Uncomment and activate `@playwright/mcp` for full browser tool suite
3. **Route browser tasks away from UIA** — Current prompt attempts UIA for everything; browser tools should be preferred for URL-based tasks
4. **Test browser workflows** — Navigate to a known page, extract content, fill and submit a form
5. **Build browser application profile** — Store known selectors and patterns for common sites
