# Microsoft UI Automation — Knowledge Index

## Source Metadata
- **Source**: Microsoft Windows SDK / .NET System.Windows.Automation
- **Type**: API Reference (not cloned — part of Windows SDK)
- **Documents**: https://learn.microsoft.com/en-us/windows/win32/winauto/
- **Last Updated**: 2026-06-12

## Core APIs & Concepts

### UIA Patterns (Control Patterns)
| Pattern | Interface | Purpose |
|---------|-----------|---------|
| InvokePattern | IInvokeProvider | Button/checkbox activation |
| ValuePattern | IValueProvider | Text input reading/writing |
| TogglePattern | IToggleProvider | Toggle state (checkbox, radio) |
| ExpandCollapsePattern | IExpandCollapseProvider | Tree nodes, combo boxes |
| SelectionPattern | ISelectionProvider | List selection |
| SelectionItemPattern | ISelectionItemProvider | Individual list item selection |
| ScrollPattern | IScrollProvider | Scrollable containers |
| ScrollItemPattern | IScrollItemProvider | Scroll item into view |
| TextPattern | ITextPatternProvider | Advanced text access |
| LegacyIAccessiblePattern | ILegacyIAccessibleProvider | MSAA fallback |
| RangeValuePattern | IRangeValueProvider | Sliders, progress bars |
| TablePattern | ITableProvider | Grid/table navigation |
| GridPattern | IGridProvider | 2D grid navigation |
| WindowPattern | IWindowProvider | Window state (min/max/close) |
| TransformPattern | ITransformProvider | Move/resize/rotate |
| DockPattern | IDockProvider | Docking containers |
| SynchronizedInputPattern | ISynchronizedInputProvider | Modal keyboard/mouse capture |
| VirtualizedItemPattern | IVirtualizedItemProvider | Large virtualized lists |
| AnnotationPattern | IAnnotationProvider | Comments/annotations on text |

### Element Properties
- **RuntimeId**: Session-unique identifier (volatile)
- **AutomationId**: Developer-assigned string (stable)
- **ControlType**: Button, Edit, List, ComboBox, etc.
- **ClassName**: Win32/MFC/WPF className
- **FrameworkId**: "Win32", "WPF", "WinForm", "DirectUI", "XAML"
- **BoundingRectangle**: Screen-space rect (may be stale)
- **IsEnabled**, **IsOffscreen**, **IsKeyboardFocusable**
- **ProcessId** (window handle via NativeWindowHandle)
- **ProviderDescription**: Debug string showing provider stack

### Event System
| Event Type | Description |
|------------|-------------|
| StructureChanged | Children added/removed |
| PropertyChanged | Name, value, toggle state, etc. |
| FocusChanged | Keyboard focus moved |
| WindowOpened/Closed | Window lifecycle |
| MenuOpened/Closed | Context menus |
| Notification | Toast alerts, screen reader announcements |
| TextChanged | Text edits |
| ToolTipOpened/Closed | Hover tooltips |
| AutomationPropertyChanged | Granular property-level changes |

### Tree Views
- **RawView**: All elements (including invisible proxy elements)
- **ControlView**: User-interactive controls only
- **ContentView**: Content-bearing elements (text, lists)
- **CacheRequest**: Bulk pre-fetch properties to avoid cross-process RPC per property
- **TreeWalker**: Manual tree traversal (FirstChild, LastChild, NextSibling, PreviousSibling, Parent)

### Yomi Implementation Opportunities
1. **ScrollItemPattern**: Add `scrollIntoView` to bring offscreen elements into viewport before interaction
2. **CacheRequest**: Batch property reads to reduce IPC overhead when walking large trees
3. **Event Subscriptions**: Subscribe to FocusChanged + WindowOpened/Closed for reactive UI updates instead of polling
4. **TransformPattern**: Move/resize windows without Win32 P/Invoke
5. **TextPattern**: Advanced text manipulation (selection ranges, formatted text)
6. **SynchronizedInputPattern**: Safer keyboard input in modal dialogs
7. **VirtualizedItemPattern**: Handle large lists (Spotify playlists, file explorer with thousands of items)
