# Research Corpus Gap Report

Generated: 2026-06-12T19:07:36Z

## Research Sources Analyzed

| Source | Analyzed | Patterns Extracted |
|---|---|---|
| FlaUI (3.5k ⭐) | ✅ | 10 patterns |
| Accessibility Insights (1.7k ⭐) | ✅ | 6 patterns |
| Browser Use (65k ⭐) | ✅ | 6 patterns |
| Open Interpreter (58k ⭐) | ✅ | 5 patterns |
| LangGraph (14k ⭐) | ✅ | 7 patterns |
| Playwright | ✅ | 6 patterns |
| OpenCV | ✅ | 7 techniques |
| PaddleOCR | ✅ | Full pipeline |
| Win32 API | ✅ | Full catalog |
| Microsoft UIA | ✅ | Full catalog |

## Implemented Patterns (matched)

| Research Pattern | Implemented? | Location |
|---|---|---|
| FlaUI: Multi-framework abstraction (UIA2+UIA3) | ✅ Using UIA3 | Program.cs |
| FlaUI: Pattern abstraction sandwich | ✅ | act-executor.ts, Program.cs |
| FlaUI: COM error translation | ✅ HRESULT → typed errors | Program.cs |
| FlaUI: Fluent condition system | ⚠️ Partial | client.ts matchElement |
| Browser Use: DOM state extraction | ✅ | get_ui_tree → flattened elements |
| Browser Use: Error recovery + retry | ✅ | recovery.ts, act-helpers.ts |
| LangGraph: Checkpointing | ✅ | graph/recovery.ts |
| LangGraph: Human-in-the-loop | ✅ Act bus | act-bus.ts |
| LangGraph: Error handler nodes | ✅ | graph/nodes/recovery.ts |
| Open Interpreter: Approval system | ✅ | safety.ts, act-bus.ts |
| Open Interpreter: Tool registry | ✅ | harness/tools.ts |
| Accessibility Insights: Tree views | ✅ raw/control/content | Program.cs |
| Accessibility Insights: Event recording | ✅ | event-recorder.ts |
| Playwright: Actionability checks | ⚠️ Partial | act-helpers.ts actionabilityFailure() |
| Win32: Foreground management | ✅ | Program.cs AttachThreadInput+ALT |
| Win32: Input simulation | ✅ | keybd_event, mouse_event |
| MS UIA: 18 control patterns | ✅ | Program.cs dispatch |
| MS UIA: Tree views | ✅ raw/control/content | Program.cs |
| PaddleOCR: OCR pipeline | ✅ | vision-layer.ts |

## Gap Patterns (not implemented or partial)

### Gap 1: FlaUI — ScrollIntoView

| Detail | Value |
|---|---|
| **Description** | FlaUI's `ScrollIntoView` pattern for bringing offscreen elements into view |
| **Implementation** | `ScrollItemPattern.ScrollIntoView()` |
| **Current** | No dedicated ScrollIntoView in Yomi |
| **Priority** | High — Many elements are offscreen and unreachable |

### Gap 2: FlaUI — UIA CacheRequest

| Detail | Value |
|---|---|
| **Description** | Batch UIA property reads via `CacheRequest` for 10-50x tree enumeration speedup |
| **Current** | Each element's properties fetched individually (9+ COM calls per node) |
| **Priority** | High — Tree enumeration is main bottleneck |

### Gap 3: FlaUI — Interpolated Mouse Movement

| Detail | Value |
|---|---|
| **Description** | Smooth animated cursor movement (human-like) between points |
| **Current** | Instant teleport via SetCursorPos |
| **Priority** | Medium — Some apps detect/don't respond to teleport |

### Gap 4: Playwright — Auto-waiting (actionability checks)

| Detail | Value |
|---|---|
| **Description** | Check element is: attached, visible, stable, enabled, not obscured before acting |
| **Current** | Partial — checks enabled + bounding rect; no stability or visibility check |
| **Priority** | High — False "success" on moving/animating elements |

### Gap 5: Playwright — Self-healing selectors

| Detail | Value |
|---|---|
| **Description** | When primary selector fails, try alternatives (text → role → test-id → nth) |
| **Current** | Manual fallback ladder in resolveElement |
| **Priority** | Medium — Current approach works but is not automated |

### Gap 6: OpenCV — Template Matching for UI Icons

| Detail | Value |
|---|---|
| **Description** | Use `matchTemplate` to find icons/buttons by visual appearance |
| **Current** | Not implemented |
| **Priority** | Medium — Useful for apps with no accessibility labels |

### Gap 7: OpenCV — Flash Detection

| Detail | Value |
|---|---|
| **Description** | Detect UI state changes via frame differencing (flashing buttons, loading spinners) |
| **Current** | Not implemented |
| **Priority** | Low — Nice to have for advanced state detection |

### Gap 8: Open Interpreter — Context Compaction

| Detail | Value |
|---|---|
| **Description** | Compress long conversation/memory context to fit token limits |
| **Current** | Basic memory compaction in memory.md |
| **Priority** | Low — Current compaction approach works |

### Gap 9: Open Interpreter — Sandbox Safety

| Detail | Value |
|---|---|
| **Description** | Execute bash in sandboxed environment with filesystem/network restrictions |
| **Current** | No bash sandboxing in Yomi |
| **Priority** | Medium — Security concern for autonomous mode |

## Adoption Candidates (from research_index.json)

| Candidate | Score | Current Status | Action |
|---|---|---|---|
| UIA CacheRequest pattern | 26/30 (implement) | ❌ Missing | High priority |
| ScrollIntoView | 25/30 (implement) | ❌ Missing | High priority |
| Actionability checks (Playwright) | 24/30 (implement) | ⚠️ Partial | Medium priority |
| Interpolated mouse movement | 20/30 (propose/schedule) | ❌ Missing | Low priority |
| Self-healing selectors | 22/30 (propose/schedule) | ⚠️ Partial | Medium priority |
| Template matching (OpenCV) | 18/30 (backlog) | ❌ Missing | Low priority |
| UIA event recorder (improved) | 21/30 (propose/schedule) | ⚠️ Basic | Medium priority |

## Recommendations

1. **Implement UIA CacheRequest** — Will speed up tree enumeration 10-50x, directly improving all UIA capabilities
2. **Implement ScrollIntoView** — Many UIA elements are offscreen; this is the standard UIA approach
3. **Complete actionability checks** — Add visibility, stability, and not-obscured checks before acting
4. **Enable Playwright browser automation** — Most impactful single change for web-related tasks
5. **Build automated self-healing selectors** — When direct match fails, try progressive fallbacks
6. **Add template matching** — Visual icon detection for apps without accessibility labels
