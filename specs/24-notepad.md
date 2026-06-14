# Notepad (Windows 11) — UIA Specification

**App:** Microsoft.WindowsNotepad (Store)
**Version:** 11.2604.5.0
**Executable:** `C:\Program Files\WindowsApps\Microsoft.WindowsNotepad_*_8wekyb3d8bbwe\Notepad\Notepad.exe`
**Framework:** WinUI 3 (XAML) with Win32 hosting
**Editor Engine:** RichEditD2DPT (Rich Text control)

---

## 1. Window Structure

```
Notepad Window (ClassName="Notepad", ControlType=Window)
├── NotepadTextBox (Pane)                       — editor container, z-order layer
│   └── Text editor (Document, RichEditD2DPT)   — actual text editing surface
│       Patterns: ValuePattern, TextPattern
├── DesktopChildSiteBridge (Pane)               — tab row bridge
│   └── InputSiteWindowClass (Pane)             — IME/input site
├── TabView (Tab, AutomationId="Tabs")          — tab container
│   └── TabListView (List, AutomationId="TabListView")
│       ├── TabItem_A (ListViewItem)
│       ├── TabItem_B (ListViewItem)
│       └── ...
├── Button "Close Tab" (InvokePattern, Aid="CloseButton")
├── Button "Add New Tab" (InvokePattern, Aid="AddButton")
├── DesktopChildSiteBridge (Pane)               — toolbar row bridge
│   └── InputSiteWindowClass (Pane)
├── MenuBar (AutomationId="MenuBar")
│   ├── MenuItem "File" (Invoke, ExpandCollapse, Aid="File")
│   ├── MenuItem "Edit" (Invoke, ExpandCollapse, Aid="Edit")
│   └── MenuItem "View" (Invoke, ExpandCollapse, Aid="View")
├── [Toolbar Buttons — see §2]
├── DesktopChildSiteBridge (Pane)               — status bar bridge
│   └── InputSiteWindowClass (Pane)
├── StatusBar
│   ├── Text "Line X, Column Y" (Aid="ContentTextBlock")
│   ├── Text "N characters" (Aid="ContentTextBlock")
│   ├── Button "Formatted"|"Plain text" (Invoke, Aid="ContentButton")
│   ├── Text "Zoom" (Aid="ContentTextBlock")
│   ├── Text "Windows (CRLF)" (Aid="ContentTextBlock")
│   └── Text "UTF-8" (Aid="ContentTextBlock")
└── TeachingTip overlays
    ├── PrivacyTeachingTip (Window)
    ├── PsDownloadDetailTeachingTip (Pane)
    └── PsDownloadLightTeachingTip (Pane)
```

---

## 2. Formatting Toolbar

All buttons are located at `y=120` in the toolbar row. All are `IsKeyboardFocusable=true`.

### Dropdown Controls (InvokePattern + ExpandCollapsePattern)

| Name | ClassName | Rect | AutomationId | Patterns |
|------|-----------|------|-------------|----------|
| Headings | `DropDownButton` | `363,120,56,32` | — | Invoke, ExpandCollapse, ScrollItem |
| Lists | `DropDownButton` | `419,120,56,32` | — | Invoke, ExpandCollapse, ScrollItem |
| Table | `DropDownButton` | `603,120,56,32` | — | Invoke, ExpandCollapse, ScrollItem |
| Writing tools | `DropDownButton` | `804,120,56,32` | `RewriteDropDownButton` | Invoke, ExpandCollapse, ScrollItem |

### Toggle Controls (TogglePattern)

| Name | ClassName | Rect | Patterns |
|------|-----------|------|----------|
| Bold (Ctrl+B) | `ToggleButton` | `475,120,32,32` | Toggle, ScrollItem |
| Italic (Ctrl+I) | `ToggleButton` | `507,120,32,32` | Toggle, ScrollItem |
| Strikethrough (Ctrl+Shift+X) | `ToggleButton` | `539,120,32,32` | Toggle, ScrollItem |
| Link (Ctrl+K) | `ToggleButton` | `571,120,32,32` | Toggle, ScrollItem |
| Clear formatting (Ctrl+Space) | `ToggleButton` | `659,120,32,32` | Toggle, ScrollItem |

### Icon-Only Buttons (InvokePattern)

| Name | ClassName | Rect | AutomationId |
|------|-----------|------|-------------|
| What's new | `Button` | `864,121,30,30` | `FREButton` |
| User avatar | `Button` | `898,120,30,32` | `AvatarButton` |
| Settings | `Button` | `932,120,30,32` | `SettingsButton` |

---

## 3. Headings Dropdown Items

On `ExpandCollapsePattern.Expand()`, the popup appears as a `PopupWindowSiteBridge` containing `Popup` with these `ListViewItem` entries:

| Display Name | Maps To |
|-------------|---------|
| Title | Heading level 1 (largest) |
| Subtitle | Heading level 2 |
| Heading | Heading level 3 |
| Subheading | Heading level 4 |
| Section | Heading level 5 |
| Subsection | Heading level 6 |
| Body | Normal text (no heading) |

Invoke: find `ListItem` by `Name`, then use `InvokePattern.Invoke()`.

---

## 4. Lists Dropdown Items

On `ExpandCollapsePattern.Expand()`:

| Index | Name (approximate) | Action |
|-------|-------------------|--------|
| 0 | Bullet / Bulleted list | Applies unordered list |
| 1 | Number / Numbered list | Applies ordered list |

Invoke: find `ListItem` by name or index, then `InvokePattern.Invoke()`.

---

## 5. Menu Inventory

### File Menu
`New tab`, `New window`, `New Markdown tab`, `Open`, `Recent`, `Save`, `Save as`, `Save all`, `Page setup`, `Print`, `Close tab`, `Close window`, `Exit`

### Edit Menu
`Undo`, `Cut`, `Copy`, `Paste`, `Delete`, `Clear formatting`, `Search with Bing`, `Define with Bing`, `Find`, `Find next`, `Find previous`, `Replace`, `Go to`, `Select all`, `Time/Date`, `Font`

### View Menu
`Zoom`, `Status bar`, `Word wrap`, `Markdown`

Keyboard triggers: `Alt+F`, `Alt+E`, `Alt+V` then navigate with arrow keys. Use `ExpandCollapsePattern.Expand()` on the `MenuItem` to open, then find sub-items by enumerating `MenuItem` and `ListItem` descendants.

---

## 6. Text Editor

| Property | Value |
|----------|-------|
| ControlType | `Document` |
| ClassName | `RichEditD2DPT` |
| Name | `Text editor` |
| BoundingRect | `84,153,886,674` (default window) |
| IsKeyboardFocusable | `true` |
| SupportedPatterns | `ValuePattern`, `TextPattern` |

### TextPattern Usage
- `DocumentRange.GetText(maxLen)` — read document content
- `GetSelection()` — get current selection ranges
- `Range.Select()` — programmatically select text
- `TextUnit` — Character, Word, Line, Paragraph

### Limitations
- `TextPattern` does NOT expose `SetText()` or write operations
- All text input must go through `SendKeys` or keyboard simulation
- `MoveEndpointByUnit(TextUnit, int)` requires 3 args: `(endpoint, unit, count)`

---

## 7. Tab Management

| Element | AutomationId | ControlType | Patterns |
|---------|-------------|-------------|----------|
| Tab container | `Tabs` | `Tab` | Selection, ScrollItem |
| Tab list | `TabListView` | `List` | Selection, Scroll, ItemContainer |
| Tab items | — | `TabItem` (ListViewItem) | SelectionItem, ScrollItem, VirtualizedItem |
| Close Tab | `CloseButton` | `Button` | Invoke, ScrollItem |
| Add New Tab | `AddButton` | `Button` | Invoke, ScrollItem |

TabItem `Name` format: `"<filename>.<modified_status>."` (e.g. `"Untitled. Unmodified."` or `"doc.txt. Modified."`).
The `Text` child contains just the filename without status.

---

## 8. Save Dialog

The Save As dialog is a Win32 `#32770` dialog child of the Notepad window. Key UIA elements:

| Name | AutomationId | ControlType | Notes |
|------|-------------|-------------|-------|
| File name label | `SaveDialogLabel` | Text | Static label |
| File name field | `FileNameControlHost` | Pane (contains Edit) | Type path here |
| File name edit | `1001` | Edit | The actual text input |
| Save button | `1` | Pane (Button) | Does NOT support InvokePattern — use keyboard Enter |
| Cancel button | `2` | Pane (Button) | |
| Encoding | — | ComboBox | UTF-8, UTF-8 with BOM, ANSI |

**Keyboard shortcuts in Save dialog:**
- `Alt+N` — Focus file name field
- `Alt+S` — Focus Save button
- `Enter` — Confirm
- `Tab` — Cycle controls

---

## 9. Status Bar

Located at `y=827` (bottom of window). Elements are `TextBlock` controls with shared `AutomationId="ContentTextBlock"`:

| Content | Purpose |
|---------|---------|
| `Line X, Column Y` | Cursor position |
| `N characters` / `N words` | Document statistics |
| `Formatted` or `Plain text` | Document mode (clickable button, `Aid="ContentButton"`) |
| `Zoom` (with % label) | Zoom level |
| `Windows (CRLF)` | Line ending format |
| `UTF-8` | Encoding |

---

## 10. Supported File Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Plain Text | `.txt` | Default format |
| Markdown | `.md` | Rich formatting (headings, bold, italic) is converted to Markdown syntax on save |

**Not supported:** RTF, DOCX, HTML. Notepad saves only plain text or Markdown. Rich formatting is lost when saving — it gets serialized as Markdown markup.

---

## 11. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Bold toggle |
| `Ctrl+I` | Italic toggle |
| `Ctrl+Shift+X` | Strikethrough toggle |
| `Ctrl+K` | Insert/edit link |
| `Ctrl+Space` | Clear formatting |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+X` | Cut |
| `Ctrl+C` | Copy |
| `Ctrl+V` | Paste |
| `Ctrl+A` | Select all |
| `Ctrl+F` | Find |
| `Ctrl+H` | Replace |
| `Ctrl+G` | Go to |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+N` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Shift+N` | New window |
| `Ctrl+Plus` | Zoom in |
| `Ctrl+Minus` | Zoom out |
| `Ctrl+0` | Reset zoom |
| `Alt+F` | File menu |
| `Alt+E` | Edit menu |
| `Alt+V` | View menu |
| `F5` | Insert time/date |
| `Ctrl+Shift+L` | Toggle list |

---

## 12. UIA Patterns Reference

| Pattern | Used By |
|---------|---------|
| `InvokePattern` | Buttons (What's new, Avatar, Settings, Close Tab, Add Tab), DropDownButtons, Menu items |
| `TogglePattern` | Bold, Italic, Strikethrough, Link, Clear formatting |
| `ExpandCollapsePattern` | Headings, Lists, Table, Writing tools, Menu items (File/Edit/View) |
| `TextPattern` | Editor (Document control) — read content, selection |
| `ValuePattern` | Editor (Document control), status bar text |
| `SelectionPattern` | Tab list, Items View (file dialogs) |
| `SelectionItemPattern` | Tab items |
| `ScrollItemPattern` | All toolbar buttons, tab list items |
| `ScrollPattern` | Tab list |
| `ItemContainerPattern` | Tab list |
| `TransformPattern` | InputSiteWindowClass panes |
| `VirtualizedItemPattern` | Tab items (virtualized in list) |

---

## 13. Window Geometry (Default)

```
Window:   Left=78, Top=78, Width=898, Height=787
Editor:   Left=84, Top=153, Width=886, Height=674
Toolbar:  Top=120, Height=32
Status:   Top=827, Height=32
```

---

## 14. Stress Test Baseline

| Metric | Value |
|--------|-------|
| Cycles | 20 (100 operations) |
| Operations per cycle | 5 (Bold → Italic → Undo → Redo → Clear formatting) |
| UIA success rate | 100% |
| Avg latency per operation | ~46 ms |
| Total test time | ~4.6s (UIA only, excluding SendKeys sleep) |

---

## 15. Known Issues

1. **Toggle buttons use TogglePattern, not InvokePattern.** Don't try to Invoke — call `TogglePattern.Toggle()` instead.
2. **Dropdown menus use ExpandCollapsePattern.** Call `.Expand()` to open, `.Collapse()` to close. Items appear as `ListItem` children of a `PopupWindowSiteBridge`.
3. **Save button in file dialog has no InvokePattern.** The "Save" button (`Aid="1"`) is a Pane, not a Button. Use keyboard `Enter` instead.
4. **Formatting not preserved in .txt files.** Only .md saves trigger Markdown serialization of formatting.
5. **SendKeys required for text input.** The RichEditD2DPT Document control does not expose write operations via UIA.
6. **Session restore.** Notepad restores previous tabs on launch from `%LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_8wekyb3d8bbwe\LocalState\TabState`.
7. **TeachingTip overlays.** Privacy and AI model download tips may appear on first launch and obscure underlying controls.
