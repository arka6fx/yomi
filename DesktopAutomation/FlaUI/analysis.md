# FlaUI Knowledge Extraction

## Architecture Overview
FlaUI is a .NET library wrapping both UIA2 (managed `System.Windows.Automation`) and UIA3 (COM `IUIAutomation`) providers under a common abstraction layer. It provides fluent element finding, pattern access, wait primitives, and input simulation.

## Key Architectural Patterns

### 1. Multi-Framework Abstraction (UIA2 + UIA3)
**Files:** `src/FlaUI.Core/AutomationBase.cs`, `UIA2Automation.cs`, `UIA3Automation.cs`

- Abstract `AutomationBase` with `IPropertyLibrary`, `IEventLibrary`, `IPatternLibrary`, `ITextAttributeLibrary`
- `ITreeWalkerFactory` produces 3 standard views + custom filtered walkers
- Concrete implementations detect available COM interfaces (`CUIAutomation8` → `CUIAutomation` fallback)

**Yomi relevance**: Yomi's C# helper could adopt this abstraction to support both UIA2 and UIA3 providers, with graceful fallback on older Windows versions.

### 2. Pattern Abstraction Sandwich
**Files:** `src/FlaUI.Core/Patterns/Infrastructure/PatternBase.cs`, `AutomationPattern.cs`

- `IPattern` (marker) → `PatternBase<TNativePattern>` (caching, lazy init) → Concrete pattern
- `AutomationPattern<T, TNative>` with `Pattern` / `PatternOrDefault` / `TryGetPattern` / `IsSupported`
- Fast capability check via `_patternId.AvailabilityProperty` (boolean UIA property)

**Yomi relevance**: Yomi's 30+ JSON-RPC methods could be refactored into this pattern with `try/get/or-default` semantics instead of raw error handling.

### 3. Retry Engine
**Files:** `src/FlaUI.Core/Tools/Retry.cs`, `RetryResult.cs`, `RetrySettings.cs`

- Generic `Retry.While<T>(Func<T>, Func<T,bool>, settings)` — timeout-based, not iteration-based
- Convenience methods: `WhileTrue`, `WhileFalse`, `WhileNull`, `WhileEmpty`, `WhileException`, `Find`
- Rich `RetryResult<T>` with `Success`, `TimedOut`, `LastException`, `Iterations`, `Duration`
- `ignoreException` flag for resilient polling through transient UIA COM errors

**Yomi relevance**: Replace ad-hoc retries in Yomi's action helpers with this structured retry framework. The `WhileException` mode is critical for UIA's ephemeral COM errors.

### 4. Wait/Condition Primitives
**Files:** `src/FlaUI.Core/Input/Wait.cs`, `AutomationElements/AutomationElementExtensions.cs`

- `UntilInputIsProcessed()` — simple sleep after input
- `UntilResponsive(element)` — walks up tree, finds HWND, calls `SendMessageTimeout(WM_NULL)`
- `WaitUntilClickable()` — retry on `TryGetClickablePoint`
- `WaitUntilEnabled()` — retry on `IsEnabled`

**Yomi relevance**: The `SendMessageTimeout(WM_NULL)` approach for responsiveness detection is superior to polling. Yomi should adopt this for checking app responsiveness before interaction.

### 5. COM Error Translation
**Files:** `src/FlaUI.Core/Tools/Com.cs`, `Exceptions/`

- `Com.Call(Action)` wraps all UIA3 native calls
- Maps UIA-specific HRESULTs to typed exceptions:
  - `0x80040200` → `ElementNotEnabledException`
  - `0x80040201` → `ElementNotAvailableException`
  - `0x80040202` → `NoClickablePointException`
- Typed exception hierarchy: `FlaUIException` → 12 derived types

**Yomi relevance**: Yomi's C# helper should adopt this error translation. Currently raw COMException HRESULTs need numeric checks on the TypeScript side.

### 6. Disposable Cache Scope
**Files:** `src/FlaUI.Core/CacheRequest.cs`

- Stack-based `IDisposable` activation: `using (new CacheRequest{...}.Activate()) { ... }`
- `CacheRequest.IsCachingActive` checked by all TreeWalker and Find methods
- `ForceNoCode()` override stack for emergency no-cache mode
- Supports batching both `PatternId` and `PropertyId` pre-fetch

**Yomi relevance**: Yomi's tree walks could use cache requests to batch `BoundingRectangle`, `Name`, `ControlType`, `AutomationId` reads in a single cross-process round-trip.

### 7. Condition System (Fluent)
**Files:** `src/FlaUI.Core/Conditions/ConditionFactory.cs`, `PropertyCondition.cs`, `ConditionBase.cs`

- `ByAutomationId()`, `ByControlType()`, `ByClassName()`, `ByName()`, `ByFrameworkId()`, etc.
- `PropertyConditionFlags`: `None`, `IgnoreCase`, `MatchSubstring` (Win 1809+)
- Fluent chaining: `.And()`, `.Or()`, `.Not()` — smartly merges into composite conditions
- XPath support via `AutomationElementXPathNavigator`
- Nested finding: `FindFirstNested(params ConditionBase[])` — sequential scope narrowing

**Yomi relevance**: Yomi's element finding could support `IgnoreCase` and `MatchSubstring` flags. The fluent condition builder is more ergonomic than raw AND/OR tree construction.

### 8. Interpolated Mouse Movement
**Files:** `src/FlaUI.Core/Input/Mouse.cs`, `Interpolation.cs`

- `MoveTo(int,int)` uses linear interpolation with configurable timing
- `Click(MouseButton)` prevents accidental double-click via timing check
- `Drag(start,end)` — sequence down+move+up
- Multi-monitor `SetCursorPos` retry workaround for coordinate mismatch

**Yomi relevance**: Natural-looking mouse gestures improve reliability. The multi-monitor cursor retry is directly applicable to Yomi.

### 9. Framework-Type-Aware Window/Context-Menu
**Files:** `src/FlaUI.Core/AutomationElements/Window.cs`

- `Window.ContextMenu` switches behavior based on framework type:
  - Win32: desktop-level `Menu` named "Context"/"System" or class "#32768"
  - WinForms: main window child `Menu`/`ToolBar` named "DropDown"
  - WPF: via `Popup` → `Menu`
- `ModalWindows` → find all descendant windows with `IsModal == true`
- `Close()` → try titlebar close button first, then `WindowPattern.Close()`

**Yomi relevance**: Yomi's dialog/window handling should be framework-type-aware for reliable context menu and modal dialog detection.

### 10. Three-Fallback Clickable Point
**Files:** `src/FlaUI.Core/AutomationElements/AutomationElement.cs`

- `TryGetClickablePoint(out Point)`: 
  1. Direct UIA `GetClickablePoint` via pattern
  2. Get `ClickablePointProperty` from cache
  3. Fallback to `BoundingRectangle` center
- `IsAvailable` staleness detection: try-read `ProcessId` with catch

**Yomi relevance**: Three-fallback clickable point should be the standard in Yomi's `click_element` RPC method.
