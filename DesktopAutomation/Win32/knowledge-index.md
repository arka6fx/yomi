# Win32 API — Knowledge Index

## Source Metadata
- **Source**: Microsoft Windows SDK (not cloned — API reference)
- **Docs**: https://learn.microsoft.com/en-us/windows/win32/api/
- **Scope**: Win32 APIs relevant to desktop automation
- **Last Updated**: 2026-06-12

## Window Management APIs

### Enumeration & Discovery
- `EnumWindows()`: Enumerate all top-level windows
- `EnumChildWindows()`: Enumerate child windows of a parent
- `FindWindow()`, `FindWindowEx()`: Find by class name + window title
- `GetWindowText()`: Read window title
- `GetClassName()`: Read window class name
- `GetWindowThreadProcessId()`: Get owning process ID
- `IsWindowVisible()`, `IsWindowEnabled()`: State checks
- `GetWindowRect()`: Screen-space bounding rectangle
- `GetClientRect()`: Client-area rectangle
- `WindowFromPoint()`: Hit-test point to window

### Manipulation
- `SetForegroundWindow()`: Bring to foreground (restricted in modern Windows)
- `ShowWindow()`: Show, hide, minimize, maximize, restore (SW_SHOW, SW_HIDE, SW_MINIMIZE, etc.)
- `SetWindowPos()`: Move, resize, change Z-order (with HWND_TOP, HWND_BOTTOM, flags)
- `MoveWindow()`: Simpler move+resize
- `CloseWindow()`: Minimize (not close — use WM_CLOSE for close)
- `DestroyWindow()`: Force-destroy (dangerous)
- `BringWindowToTop()`: Raise window
- `SetActiveWindow()`: Set active window (same thread only)
- `AllowSetForegroundWindow()`: Grant foreground permission to another process
- `LockSetForegroundWindow()`: Disable foreground changes
- `AttachThreadInput()`: Share input state between threads for reliable foreground activation

### Visual State
- `GetWindowLong()` / `SetWindowLong()`: Window style bits (WS_VISIBLE, WS_MINIMIZE, WS_MAXIMIZE)
- `IsIconic()`: Check if minimized
- `IsZoomed()`: Check if maximized
- `GetWindowPlacement()`: Full window state (normal/minimized/maximized + position)
- `AnimateWindow()`: Show/hide with animation

## Input APIs

### Keyboard
- `SendInput()`: Low-level keystroke injection (hardware scan codes)
- `keybd_event()`: Legacy keyboard simulation
- `VkKeyScan()`: Character → virtual key + shift state
- `MapVirtualKey()`: Virtual key ↔ scan code conversion
- `GetKeyboardState()`: Current state of all virtual keys (track modifiers)
- `GetAsyncKeyState()`: Real-time key state (for detection, not simulation)
- `ToUnicode()`: Virtual key → Unicode character
- Modifier keys: VK_CONTROL, VK_MENU (Alt), VK_SHIFT, VK_LWIN/VK_RWIN (Windows key)

### Mouse
- `SendInput()`: Mouse movement + clicks (MOUSEINPUT with MOUSEEVENTF_MOVE, *_LEFTDOWN, etc.)
- `mouse_event()`: Legacy mouse simulation
- `SetCursorPos()`: Move cursor to absolute screen coordinates
- `GetCursorPos()`: Current cursor position
- `GetDoubleClickTime()`: System double-click threshold
- `SystemParametersInfo(SPI_GETWHEELSCROLLLINES)`: Scroll sensitivity
- `ClipCursor()`: Confine cursor to a rectangle (for drag operations)

### Touch/Multi-Touch (Not currently used by Yomi)
- `InjectTouchInput()`: Windows 8+ touch injection
- Multi-touch gestures (pinch, rotate, two-finger scroll)

## Process & Thread Management
- `CreateProcess()`: Launch application with STARTUPINFO (hide window, set working dir)
- `OpenProcess()` + `TerminateProcess()`: Kill process by PID
- `GetProcessImageFileName()`: Get executable path from process handle
- `EnumProcesses()`: List all running processes
- `CreateToolhelp32Snapshot()`: Process + thread + module enumeration
- `WaitForInputIdle()`: Wait until process is ready for input
- `ShellExecute()`: Launch file with default handler, open URLs
- `GetExitCodeProcess()`: Check if process still running
- `GetProcessTimes()`: Process CPU time (detect hung processes)

## Clipboard
- `OpenClipboard()` / `CloseClipboard()`
- `GetClipboardData()` / `SetClipboardData()`
- `EmptyClipboard()`
- `EnumClipboardFormats()`: Check what formats are available
- `IsClipboardFormatAvailable()`: Check for specific format (CF_TEXT, CF_UNICODETEXT, CF_BITMAP)
- `CountClipboardFormats()`: Number of formats available

## Accessibility (MSAA)
- `AccessibleObjectFromWindow()`: Get IAccessible from HWND
- `AccessibleObjectFromPoint()`: Hit-test to IAccessible
- `WindowFromAccessibleObject()`: IAccessible back to HWND
- `CreateStdAccessibleProxy()`: Default IAccessible for standard controls

## Yomi Implementation Opportunities
1. **AttachThreadInput for reliable foreground**: `AttachThreadInput(yomi_thread, target_thread, TRUE)` → `SetForegroundWindow()` → detach — more reliable than raw SetForegroundWindow
2. **AllowSetForegroundWindow**: Add to sidecar startup so UIA helper can bring windows to foreground
3. **EnumWindows as UIA fallback**: When UIA tree is unavailable, fall back to Win32 window enumeration
4. **WaitForInputIdle**: Before interacting with freshly launched apps
5. **WindowFromPoint for hit-testing**: Cross-reference UIA element rects with actual HWND at that point
6. **CreateProcess with SW_HIDE**: Launch apps without flashing console windows
7. **SendInput for key combos**: When UIA keyboard patterns fail, fall back to SendInput with proper scan codes
