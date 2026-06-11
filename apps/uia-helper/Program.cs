using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;
using FlaUI.UIA3;
using NAudio.CoreAudioApi;

namespace Yomi.UiaHelper;

// JSON-RPC (line-delimited) helper that exposes Windows UI Automation to the Bun sidecar.
// One JSON object per stdin line -> one JSON object per stdout line. stdout stays clean (JSON only).
internal static class Program
{
    private static readonly UIA3Automation Automation = new();

    // ref -> live element, rebuilt on every get_ui_tree snapshot so refs stay stable within a turn.
    private static Dictionary<string, AutomationElement> _refs = new();
    private static int _windowSeq;

    private const int DefaultMaxNodes = 400;
    private const int DefaultMaxDepth = 40;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint MouseRightDown = 0x0008;
    private const uint MouseRightUp = 0x0010;
    private const uint MouseMiddleDown = 0x0020;
    private const uint MouseMiddleUp = 0x0040;

    // Media/volume virtual-key codes. These travel to the app owning the system media session
    // (Spotify registers for it), so they act in the background without any window focus.
    private const byte VkMediaPlayPause = 0xB3;
    private const byte VkMediaNextTrack = 0xB0;
    private const byte VkMediaPrevTrack = 0xB1;
    private const byte VkMediaStop = 0xB2;
    private const byte VkVolumeUp = 0xAF;
    private const byte VkVolumeDown = 0xAE;
    private const byte VkVolumeMute = 0xAD;
    private const byte VkMenu = 0x12; // ALT — tapped to unlock SetForegroundWindow

    private const uint KeyEventExtended = 0x0001;
    private const uint KeyEventKeyUp = 0x0002;
    private const int SwRestore = 9;
    private const int SwMaximize = 3;
    private static int _subReqSeq; // unique id sequence for get_subtree refs
    private static IntPtr _lastFocusHwnd = IntPtr.Zero;
    private static DateTime _lastFocusEvent = DateTime.MinValue;
    private static bool _focusTrackingStarted;

    [STAThread]
    private static void Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.InputEncoding = Encoding.UTF8;
        var stdout = Console.Out;

        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            line = line.TrimStart('﻿'); // tolerate a stray UTF-8 BOM on the first line

            EnsureFocusTracking();

            JsonElement req;
            try { req = JsonSerializer.Deserialize<JsonElement>(line); }
            catch { continue; } // ignore non-JSON noise

            object? id = req.TryGetProperty("id", out var idEl) ? idEl.Clone() : null;
            var response = new Dictionary<string, object?> { ["id"] = id };

            try
            {
                var method = req.TryGetProperty("method", out var m) ? m.GetString() : null;
                response["result"] = Dispatch(method, req);
            }
            catch (Exception ex)
            {
                response["error"] = new { message = ex.Message };
            }

            stdout.WriteLine(JsonSerializer.Serialize(response));
            stdout.Flush();
        }
    }

    private static void EnsureFocusTracking()
    {
        if (_focusTrackingStarted) return;
        _focusTrackingStarted = true;
        try
        {
            // Poll foreground window every 500ms. Simpler than UIA focus-changed events
            // (FlaUI 4.0 UIA3 doesn't expose FocusChangedEvent in the managed API).
            Console.Error.WriteLine("[uia/helper] focus tracking started (500ms poll)");
            var timer = new System.Threading.Timer(_ =>
            {
                try
                {
                    var hwnd = GetForegroundWindow();
                    if (hwnd == IntPtr.Zero)
                    {
                        Console.Error.WriteLine("[uia/helper] focus poll: no foreground window");
                        return;
                    }
                    if (hwnd == _lastFocusHwnd) return;
                    Console.Error.WriteLine($"[uia/helper] focus changed: hwnd=0x{hwnd.ToInt64():X}");
                    _lastFocusHwnd = hwnd;
                    var len = GetWindowTextLength(hwnd);
                    if (len <= 0)
                    {
                        Console.Error.WriteLine("[uia/helper] focus window has no title text");
                        return;
                    }
                    var sb = new System.Text.StringBuilder(len + 1);
                    GetWindowText(hwnd, sb, sb.Capacity);
                    var name = sb.ToString();
                    Console.Error.WriteLine($"[uia/helper] focus window title=\"{name}\"");
                    var frame = new { @event = "focus_changed", hwnd = hwnd.ToInt64(), window = name };
                    Console.Out.WriteLine(JsonSerializer.Serialize(frame));
                    Console.Out.Flush();
                    Console.Error.WriteLine("[uia/helper] focus event frame emitted");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[uia/helper] focus poll error: {ex.Message}");
                }
            }, null, 500, 500);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[uia/helper] focus tracking init failed: {ex.Message}");
        }
    }

    private static object Dispatch(string? method, JsonElement req)
    {
        var p = req.TryGetProperty("params", out var pr) ? pr : default;
        return method switch
        {
            "ping" => new { ok = true },
            "get_window_info" => GetWindowInfo(p),
            "get_ui_tree" => GetUiTree(p),
            "invoke_element" => InvokeElement(p),
            "set_value" => SetValue(p),
            "toggle_element" => ToggleElement(p),
            "click_element" => ClickElement(p),
            "type_text" => TypeText(p),
            "press_key" => PressKey(p),
            "click_point" => ClickPoint(p),
            "media_key" => MediaKey(p),
            "get_app_volume" => GetAppVolume(p),
            "set_app_volume" => SetAppVolume(p),
            "find_window" => FindWindow(p),
            "get_foreground" => GetForeground(),
            "set_foreground" => SetForeground(p),
            "maximize_window" => MaximizeWindow(p),
            "set_range_value" => SetRangeValue(p),
            "expand_element" => ExpandElement(p),
            "collapse_element" => CollapseElement(p),
            "scroll" => ScrollElement(p),
            "right_click" => RightClick(p),
            "get_subtree" => GetSubtree(p),
            "find_element" => FindElement(p),
            "get_text" => GetText(p),
            "get_children" => GetChildren(p),
            "get_focus_tree" => GetFocusTree(p),
            _ => throw new InvalidOperationException($"unknown method: {method}"),
        };
    }

    // --- Snapshot: flatten the control view of the foreground window ---

    private static object GetWindowInfo(JsonElement p)
    {
        var window = ResolveWindow(p);
        return new { window = SafeName(window) };
    }

    private static object GetUiTree(JsonElement p)
    {
        var maxNodes = GetInt(p, "maxNodes", DefaultMaxNodes);
        var maxDepth = GetInt(p, "maxDepth", DefaultMaxDepth);
        // Lite mode skips the per-node pattern enumeration (9 COM calls) + rangeValue + automationId,
        // which dominate the walk cost on large trees (e.g. WhatsApp). Callers that only need
        // role/name/rect/enabled/value pass lite:true for a ~3x faster snapshot.
        var lite = p.ValueKind == JsonValueKind.Object && p.TryGetProperty("lite", out var lt) &&
                   lt.ValueKind == JsonValueKind.True;
        var window = ResolveWindow(p);

        _refs = new Dictionary<string, AutomationElement>();
        var windowId = ++_windowSeq;
        var elements = new List<object>();
        var walker = Automation.TreeWalkerFactory.GetControlViewWalker();
        var winRect = SafeRect(window);
        var truncated = false;

        var elementSeq = 0;
        // Resilient walk: a live WebView2 tree (Spotify) mutates mid-enumeration, so a single element
        // or sibling step can throw a UIA/COM error. Guard each step so one bad node doesn't abort the
        // whole snapshot — we return whatever rendered instead of failing the entire get_ui_tree.
        void Walk(AutomationElement el, int depth)
        {
            if (elements.Count >= maxNodes) { truncated = true; return; }
            if (depth > maxDepth) { truncated = true; return; }

            // Count direct children before recursing (cheap sibling iteration, no recursion).
            int childCount = 0;
            try
            {
                var c = walker.GetFirstChild(el);
                while (c != null && childCount < maxNodes)
                {
                    childCount++;
                    c = walker.GetNextSibling(c);
                }
            }
            catch { }

            try
            {
                var key = $"w{windowId}e{++elementSeq}";
                _refs[key] = el;
                elements.Add(Describe(key, el, winRect, lite, childCount));
            }
            catch { return; } // can't describe this node — skip it and its subtree

            try
            {
                var child = walker.GetFirstChild(el);
                while (child != null && elements.Count < maxNodes)
                {
                    Walk(child, depth + 1);
                    try { child = walker.GetNextSibling(child); }
                    catch { break; }
                }
                if (elements.Count >= maxNodes) truncated = true;
            }
            catch { /* children inaccessible — keep what we have */ }
        }

        Walk(window, 0);
        return new { window = SafeName(window), elements, truncated };
    }

    private static readonly List<string> NoPatterns = new();

    private static object Describe(string key, AutomationElement el, System.Drawing.Rectangle winRect, bool lite, int childCount = 0)
    {
        var rect = SafeRect(el);
        // offscreen = no usable rect, or rect doesn't intersect the window (needs ScrollIntoView/vision).
        var offscreen = rect.Width <= 0 || rect.Height <= 0 || (!winRect.IsEmpty && !winRect.IntersectsWith(rect));
        return new
        {
            @ref = key,
            role = el.Properties.ControlType.IsSupported ? el.ControlType.ToString() : "Unknown",
            name = SafeName(el),
            automationId = lite ? "" : (el.Properties.AutomationId.ValueOrDefault ?? ""),
            rect = new { x = rect.X, y = rect.Y, width = rect.Width, height = rect.Height },
            patterns = lite ? NoPatterns : SupportedPatterns(el),
            enabled = el.Properties.IsEnabled.ValueOrDefault,
            offscreen,
            value = ValueOrNull(el),
            rangeValue = lite ? (double?)null : RangeValueOrNull(el),
            childCount,
        };
    }

    // RangeValue current (0..max) — reliable for sliders like Spotify's volume whose ValuePattern
    // string is mislabeled. null when unsupported.
    private static double? RangeValueOrNull(AutomationElement el)
    {
        try
        {
            return el.Patterns.RangeValue.IsSupported
                ? el.Patterns.RangeValue.Pattern.Value.ValueOrDefault
                : (double?)null;
        }
        catch { return null; }
    }

    private static List<string> SupportedPatterns(AutomationElement el)
    {
        var list = new List<string>();
        var pat = el.Patterns;
        if (pat.Invoke.IsSupported) list.Add("Invoke");
        if (pat.Value.IsSupported) list.Add("Value");
        if (pat.RangeValue.IsSupported) list.Add("RangeValue");
        if (pat.Toggle.IsSupported) list.Add("Toggle");
        if (pat.ExpandCollapse.IsSupported) list.Add("ExpandCollapse");
        if (pat.SelectionItem.IsSupported) list.Add("SelectionItem");
        if (pat.Selection.IsSupported) list.Add("Selection");
        if (pat.Scroll.IsSupported) list.Add("Scroll");
        if (pat.ScrollItem.IsSupported) list.Add("ScrollItem");
        if (pat.Text.IsSupported) list.Add("Text");
        if (pat.LegacyIAccessible.IsSupported) list.Add("LegacyIAccessible");
        return list;
    }

    // --- Actions ---

    // Activation ladder: try each supported strategy until one runs without throwing, reporting which
    // rung fired. UWP list/chat items often ignore Invoke and even a real Click but respond to
    // SelectionItem.Select or the MSAA LegacyIAccessible.DoDefaultAction — so we try them all.
    // `preferClick` moves the real mouse click ahead of pattern invokes (for click_element).
    private static (bool ok, string method, List<string> tried) TryActivate(AutomationElement el, bool preferClick)
    {
        var tried = new List<string>();
        // Pre-step: bring an off-screen item into view (best-effort, non-terminal).
        if (el.Patterns.ScrollItem.IsSupported)
        {
            try { el.Patterns.ScrollItem.Pattern.ScrollIntoView(); tried.Add("ScrollIntoView"); }
            catch { /* ignore — keep going */ }
        }

        var rungs = new List<(string name, Action act, bool supported)>();
        var invoke = ("Invoke", (Action)(() => el.Patterns.Invoke.Pattern.Invoke()), el.Patterns.Invoke.IsSupported);
        var select = ("SelectionItem.Select", (Action)(() => el.Patterns.SelectionItem.Pattern.Select()), el.Patterns.SelectionItem.IsSupported);
        var legacy = ("LegacyIAccessible.DoDefaultAction", (Action)(() => el.Patterns.LegacyIAccessible.Pattern.DoDefaultAction()), el.Patterns.LegacyIAccessible.IsSupported);
        var click = ("Click", (Action)(() => el.Click()), true);

        if (preferClick) { rungs.Add(click); rungs.Add(invoke); rungs.Add(select); rungs.Add(legacy); }
        else { rungs.Add(invoke); rungs.Add(select); rungs.Add(legacy); rungs.Add(click); }

        foreach (var (name, act, supported) in rungs)
        {
            if (!supported) continue;
            try { act(); return (true, name, tried); }
            catch (Exception ex) { tried.Add($"{name}:{ex.GetType().Name}"); }
        }
        return (false, "", tried);
    }

    private static object InvokeElement(JsonElement p)
    {
        var el = Resolve(p);
        var (ok, method, tried) = TryActivate(el, preferClick: false);
        if (!ok) return new { ok = false, error = "no activation method succeeded", tried, role = el.ControlType.ToString(), name = SafeName(el) };
        return new { ok = true, method, role = el.ControlType.ToString(), name = SafeName(el) };
    }

    private static object SetValue(JsonElement p)
    {
        var el = Resolve(p);
        var text = p.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
        var before = ValueOrNull(el);
        if (el.Patterns.Value.IsSupported && !el.Patterns.Value.Pattern.IsReadOnly)
        {
            el.Patterns.Value.Pattern.SetValue(text);
        }
        else
        {
            el.Focus();
            Keyboard.Type(text);
        }
        return new { ok = true, name = SafeName(el), before, after = ValueOrNull(el) };
    }

    private static object ToggleElement(JsonElement p)
    {
        var el = Resolve(p);
        if (el.Patterns.Toggle.IsSupported)
        {
            var before = el.Patterns.Toggle.Pattern.ToggleState.ToString();
            el.Patterns.Toggle.Pattern.Toggle();
            var after = el.Patterns.Toggle.Pattern.ToggleState.ToString();
            return new { ok = true, method = "Toggle", name = SafeName(el), before, after };
        }
        // No Toggle pattern — fall through the activation ladder (e.g. a clickable switch).
        var (ok, method, tried) = TryActivate(el, preferClick: false);
        if (!ok) return new { ok = false, error = "toggle not supported and no activation succeeded", tried, name = SafeName(el) };
        return new { ok = true, method, name = SafeName(el) };
    }

    private static object ClickPoint(JsonElement p)
    {
        var x = GetInt(p, "x", 0);
        var y = GetInt(p, "y", 0);
        var button = p.TryGetProperty("button", out var b) ? b.GetString() : "left";
        SetCursorPos(x, y);
        var (down, up) = button switch
        {
            "right" => (MouseRightDown, MouseRightUp),
            "middle" => (MouseMiddleDown, MouseMiddleUp),
            _ => (MouseLeftDown, MouseLeftUp),
        };
        mouse_event(down, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        mouse_event(up, 0, 0, 0, UIntPtr.Zero);
        return new { ok = true, x, y };
    }

    // --- Background primitives (no window focus required) ---

    // Tap a media/volume hardware key. Windows routes it to the app owning the media session, so
    // playback responds while the user keeps working in another window.
    private static object MediaKey(JsonElement p)
    {
        var key = (p.TryGetProperty("key", out var k) ? k.GetString() : null)?.Trim().ToLowerInvariant();
        var vk = key switch
        {
            "play_pause" or "playpause" or "play" or "pause" => VkMediaPlayPause,
            "next" or "next_track" or "skip" => VkMediaNextTrack,
            "previous" or "prev" or "prev_track" => VkMediaPrevTrack,
            "stop" => VkMediaStop,
            "volume_up" => VkVolumeUp,
            "volume_down" => VkVolumeDown,
            "mute" or "volume_mute" => VkVolumeMute,
            _ => (byte)0,
        };
        if (vk == 0) throw new InvalidOperationException($"unknown media key: {key}");
        keybd_event(vk, 0, KeyEventExtended, UIntPtr.Zero);
        keybd_event(vk, 0, KeyEventExtended | KeyEventKeyUp, UIntPtr.Zero);
        return new { ok = true, key };
    }

    // Set a slider/range control to an absolute value via RangeValuePattern — focus-free and
    // deterministic (used for Spotify's volume slider). Clamps to the control's min/max.
    private static object SetRangeValue(JsonElement p)
    {
        var el = Resolve(p);
        if (!el.Patterns.RangeValue.IsSupported)
            return new { ok = false, error = "RangeValue not supported", name = SafeName(el) };
        var rv = el.Patterns.RangeValue.Pattern;
        var min = rv.Minimum.ValueOrDefault;
        var max = rv.Maximum.ValueOrDefault;
        var before = rv.Value.ValueOrDefault;
        var target = p.TryGetProperty("value", out var v) && v.TryGetDouble(out var d) ? d : before;
        if (max > min) target = Math.Max(min, Math.Min(max, target));
        rv.SetValue(target);
        Thread.Sleep(60); // let the control settle so `after` reflects the real (possibly snapped) value
        return new { ok = true, name = SafeName(el), min, max, before, after = rv.Value.ValueOrDefault };
    }

    // --- Per-app volume via Windows Core Audio (focus-free, invisible — used to duck Spotify) ---

    // Apply an action to every audio session belonging to `processName` on the default render device.
    // Returns whether any matched and the first session's prior volume (0..1).
    private static (bool found, float before) ApplyToAppSessions(string processName, Action<SimpleAudioVolume>? action)
    {
        using var enumerator = new MMDeviceEnumerator();
        using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        var sessions = device.AudioSessionManager.Sessions;
        var found = false;
        var before = -1f;
        for (var i = 0; i < sessions.Count; i++)
        {
            var s = sessions[i];
            try
            {
                var pid = (int)s.GetProcessID;
                var name = System.Diagnostics.Process.GetProcessById(pid).ProcessName;
                if (!name.Equals(processName, StringComparison.OrdinalIgnoreCase)) continue;
                found = true;
                if (before < 0) before = s.SimpleAudioVolume.Volume;
                action?.Invoke(s.SimpleAudioVolume);
            }
            catch { /* session/process went away — skip */ }
        }
        return (found, before);
    }

    private static object GetAppVolume(JsonElement p)
    {
        var proc = (p.TryGetProperty("process", out var pr) ? pr.GetString() : null) ?? "";
        if (string.IsNullOrEmpty(proc)) throw new InvalidOperationException("process required");
        var (found, before) = ApplyToAppSessions(proc, null);
        return new { ok = found, process = proc, volume = found ? before : (float?)null };
    }

    private static object SetAppVolume(JsonElement p)
    {
        var proc = (p.TryGetProperty("process", out var pr) ? pr.GetString() : null) ?? "";
        if (string.IsNullOrEmpty(proc)) throw new InvalidOperationException("process required");
        if (!(p.TryGetProperty("level", out var lv) && lv.TryGetDouble(out var d)))
            throw new InvalidOperationException("level required");
        var level = (float)Math.Clamp(d, 0.0, 1.0);
        var (found, before) = ApplyToAppSessions(proc, sv => sv.Volume = level);
        return new { ok = found, process = proc, before = found ? before : (float?)null, after = found ? level : (float?)null };
    }

    // Find a top-level app window by process name and/or title substring, WITHOUT spawning a
    // PowerShell/console process (which would flash a window and steal foreground). Used to locate
    // Spotify/WhatsApp/etc. for focus-free actions.
    private static object FindWindow(JsonElement p)
    {
        var proc = p.TryGetProperty("process", out var pr) ? pr.GetString() : null;
        var titleContains = p.TryGetProperty("titleContains", out var tc) ? tc.GetString() : null;
        foreach (var process in System.Diagnostics.Process.GetProcesses())
        {
            try
            {
                if (process.MainWindowHandle == IntPtr.Zero) continue;
                var title = process.MainWindowTitle ?? "";
                if (!string.IsNullOrEmpty(proc) &&
                    !process.ProcessName.Equals(proc, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.IsNullOrEmpty(titleContains) &&
                    title.IndexOf(titleContains, StringComparison.OrdinalIgnoreCase) < 0) continue;
                return new { hwnd = process.MainWindowHandle.ToInt64(), title };
            }
            catch { /* inaccessible process — skip */ }
        }
        return new { hwnd = 0L, title = "" };
    }

    // Maximize a window so its full UI renders (used to open WhatsApp full-window).
    private static object MaximizeWindow(JsonElement p)
    {
        var raw = p.TryGetProperty("hwnd", out var hv) && hv.TryGetInt64(out var h) ? h : 0;
        if (raw == 0) throw new InvalidOperationException("hwnd required");
        ShowWindow(new IntPtr(raw), SwMaximize);
        return new { ok = true };
    }

    // The window the user is currently in — captured before a focus-shuttle so it can be restored.
    private static object GetForeground()
    {
        var hwnd = GetForegroundWindow();
        return new { hwnd = hwnd.ToInt64() };
    }

    // Bring `hwnd` to the foreground. SetForegroundWindow alone is refused by Windows when the
    // caller is a background process (foreground lock), so ForceForeground combines the proven
    // workarounds and verifies the result.
    private static object SetForeground(JsonElement p)
    {
        var raw = p.TryGetProperty("hwnd", out var hv) && hv.TryGetInt64(out var h) ? h : 0;
        if (raw == 0) throw new InvalidOperationException("hwnd required");
        return new { ok = ForceForeground(new IntPtr(raw)) };
    }

    // Robustly move a window to the foreground from a background process. Strategy: restore if
    // minimized → attach our input queue to both the current-foreground and target threads (so
    // SetForegroundWindow is permitted) → BringWindowToTop + SetForegroundWindow. If Windows still
    // refuses (foreground lock), synthesize a stray ALT tap — which counts as user input and unlocks
    // the next SetForegroundWindow — then retry. Returns whether hwnd actually ended up foreground.
    private static bool ForceForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        ShowWindow(hwnd, SwRestore);
        if (GetForegroundWindow() == hwnd) return true;

        var thisThread = GetCurrentThreadId();
        var fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out _);
        var targetThread = GetWindowThreadProcessId(hwnd, out _);

        var attachedFg = fgThread != 0 && fgThread != thisThread && AttachThreadInput(thisThread, fgThread, true);
        var attachedTarget = targetThread != 0 && targetThread != thisThread && targetThread != fgThread
            && AttachThreadInput(thisThread, targetThread, true);

        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);

        if (attachedTarget) AttachThreadInput(thisThread, targetThread, false);
        if (attachedFg) AttachThreadInput(thisThread, fgThread, false);

        if (GetForegroundWindow() == hwnd) return true;

        // Fallback: the ALT-tap unlocks the foreground-change restriction for the next call.
        keybd_event(VkMenu, 0, KeyEventExtended, UIntPtr.Zero);
        keybd_event(VkMenu, 0, KeyEventExtended | KeyEventKeyUp, UIntPtr.Zero);
        ShowWindow(hwnd, SwRestore);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        return GetForegroundWindow() == hwnd;
    }

    // Real mouse click at the element's center. UWP apps (WhatsApp, Telegram/Unigram) often ignore
    // InvokePattern but respond to an actual click — so this prefers Click, then falls back through
    // the rest of the ladder (Invoke / SelectionItem.Select / LegacyIAccessible.DoDefaultAction).
    private static object ClickElement(JsonElement p)
    {
        var el = Resolve(p);
        var (ok, method, tried) = TryActivate(el, preferClick: true);
        if (!ok) return new { ok = false, error = "no activation method succeeded", tried, role = el.ControlType.ToString(), name = SafeName(el) };
        return new { ok = true, method, role = el.ControlType.ToString(), name = SafeName(el) };
    }

    // Type literal text via real keystrokes (triggers app input handlers that ValuePattern.SetValue
    // skips — e.g. search filters and send-button enablement). Focuses `ref` first if given.
    private static object TypeText(JsonElement p)
    {
        var text = p.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
        if (p.TryGetProperty("ref", out var r) && r.GetString() is { } key && _refs.TryGetValue(key, out var el))
            el.Focus();
        Keyboard.Type(text);
        return new { ok = true };
    }

    // Send a key chord like "Enter", "Tab", "Ctrl+S", "Ctrl+Shift+X" to the focused window.
    private static object PressKey(JsonElement p)
    {
        var keys = p.TryGetProperty("keys", out var k) ? k.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(keys)) throw new InvalidOperationException("keys required");

        var parts = keys.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var mods = new List<VirtualKeyShort>();
        VirtualKeyShort? main = null;
        foreach (var part in parts)
        {
            var vk = MapKey(part);
            if (IsModifier(part)) mods.Add(vk);
            else main = vk;
        }
        if (main == null) throw new InvalidOperationException($"no main key in '{keys}'");

        foreach (var m in mods) Keyboard.Press(m);
        Keyboard.Type(main.Value);
        for (var i = mods.Count - 1; i >= 0; i--) Keyboard.Release(mods[i]);
        return new { ok = true, keys };
    }

    private static bool IsModifier(string name) => name.Trim().ToUpperInvariant() switch
    {
        "CTRL" or "CONTROL" or "ALT" or "MENU" or "SHIFT" or "WIN" or "CMD" or "META" => true,
        _ => false,
    };

    private static VirtualKeyShort MapKey(string name)
    {
        var n = name.Trim().ToUpperInvariant();
        switch (n)
        {
            case "CTRL": case "CONTROL": return VirtualKeyShort.CONTROL;
            case "ALT": case "MENU": return VirtualKeyShort.ALT;
            case "SHIFT": return VirtualKeyShort.SHIFT;
            case "WIN": case "CMD": case "META": return VirtualKeyShort.LWIN;
            case "ENTER": case "RETURN": return VirtualKeyShort.RETURN;
            case "TAB": return VirtualKeyShort.TAB;
            case "ESC": case "ESCAPE": return VirtualKeyShort.ESCAPE;
            case "SPACE": return VirtualKeyShort.SPACE;
            case "BACKSPACE": case "BACK": return VirtualKeyShort.BACK;
            case "DELETE": case "DEL": return VirtualKeyShort.DELETE;
            case "UP": return VirtualKeyShort.UP;
            case "DOWN": return VirtualKeyShort.DOWN;
            case "LEFT": return VirtualKeyShort.LEFT;
            case "RIGHT": return VirtualKeyShort.RIGHT;
            case "HOME": return VirtualKeyShort.HOME;
            case "END": return VirtualKeyShort.END;
            case "PAGEUP": case "PRIOR": return VirtualKeyShort.PRIOR;
            case "PAGEDOWN": case "NEXT": return VirtualKeyShort.NEXT;
        }
        if (n.Length == 1 && n[0] >= 'A' && n[0] <= 'Z') return Enum.Parse<VirtualKeyShort>("KEY_" + n);
        if (n.Length == 1 && n[0] >= '0' && n[0] <= '9') return Enum.Parse<VirtualKeyShort>("KEY_" + n);
        if (n.Length is 2 or 3 && n[0] == 'F' && int.TryParse(n[1..], out _)) return Enum.Parse<VirtualKeyShort>(n);
        throw new InvalidOperationException($"unknown key: {name}");
    }

    // Expand a collapsed UI tree node via ExpandCollapsePattern (e.g. tree views, dropdowns, accordions).
    private static object ExpandElement(JsonElement p)
    {
        var el = Resolve(p);
        if (!el.Patterns.ExpandCollapse.IsSupported)
            return new { ok = false, error = "ExpandCollapse pattern not supported", name = SafeName(el) };
        el.Patterns.ExpandCollapse.Pattern.Expand();
        return new { ok = true, name = SafeName(el) };
    }

    // Collapse an expanded UI tree node via ExpandCollapsePattern.
    private static object CollapseElement(JsonElement p)
    {
        var el = Resolve(p);
        if (!el.Patterns.ExpandCollapse.IsSupported)
            return new { ok = false, error = "ExpandCollapse pattern not supported", name = SafeName(el) };
        el.Patterns.ExpandCollapse.Pattern.Collapse();
        return new { ok = true, name = SafeName(el) };
    }

    // Scroll a scrollable container to a percentage (0–100) via ScrollPattern.
    // Pass -1 to leave an axis unchanged.
    private static object ScrollElement(JsonElement p)
    {
        var el = Resolve(p);
        if (!el.Patterns.Scroll.IsSupported)
            return new { ok = false, error = "Scroll pattern not supported", name = SafeName(el) };
        var horiz = GetDouble(p, "horizontalPercent", -1);
        var vert = GetDouble(p, "verticalPercent", -1);
        el.Patterns.Scroll.Pattern.SetScrollPercent(horiz, vert);
        return new { ok = true, name = SafeName(el) };
    }

    // Right-click at the element's center to open a context menu.
    private static object RightClick(JsonElement p)
    {
        var el = Resolve(p);
        var rect = SafeRect(el);
        if (rect.IsEmpty)
            return new { ok = false, error = "element has no bounding rectangle", name = SafeName(el) };
        var x = rect.X + rect.Width / 2;
        var y = rect.Y + rect.Height / 2;
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MouseRightDown, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        mouse_event(MouseRightUp, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(200); // wait for context menu to appear
        return new { ok = true, x, y };
    }

    // Walk children of a specific element and return them as a fresh subtree snapshot.
    // Refs are stable within the subtree call; call get_ui_tree again to refresh all refs.
    private static object GetSubtree(JsonElement p)
    {
        var el = Resolve(p);
        var maxNodes = GetInt(p, "maxNodes", DefaultMaxNodes);
        var maxDepth = GetInt(p, "maxDepth", DefaultMaxDepth);
        var walker = Automation.TreeWalkerFactory.GetControlViewWalker();
        var elements = new List<object>();
        var rootRect = SafeRect(el);
        _subReqSeq++;
        var seq = 0;

        void Walk(AutomationElement node, int depth)
        {
            if (elements.Count >= maxNodes || depth > maxDepth) return;

            int childCount = 0;
            try
            {
                var c = walker.GetFirstChild(node);
                while (c != null && childCount < maxNodes)
                {
                    childCount++;
                    c = walker.GetNextSibling(c);
                }
            }
            catch { }

            try
            {
                var key = $"r{_subReqSeq}n{++seq}";
                _refs[key] = node;
                elements.Add(Describe(key, node, rootRect, false, childCount));
            }
            catch { return; }

            try
            {
                var child = walker.GetFirstChild(node);
                while (child != null && elements.Count < maxNodes)
                {
                    Walk(child, depth + 1);
                    try { child = walker.GetNextSibling(child); }
                    catch { break; }
                }
            }
            catch { }
        }

        Walk(el, 0);
        return new { elements, count = elements.Count };
    }

    // Search descendants of an element by role, name, and/or automationId.
    // Returns the first match as a single UiaElement with a stable ref.
    private static AutomationElement? WalkFind(AutomationElement root, string? role, string? name, string? automationId, ITreeWalker walker, int depth, ref int visited)
    {
        if (depth > 20 || visited > 200) return null;
        visited++;
        try
        {
            var match = true;
            if (match && role != null) match = root.ControlType.ToString() == role;
            if (match && name != null) match = root.Name == name;
            if (match && automationId != null) match = root.AutomationId == automationId;
            if (match) return root;
        }
        catch { return null; }

        try
        {
            var child = walker.GetFirstChild(root);
            while (child != null)
            {
                var found = WalkFind(child, role, name, automationId, walker, depth + 1, ref visited);
                if (found != null) return found;
                try { child = walker.GetNextSibling(child); }
                catch { break; }
            }
        }
        catch { }
        return null;
    }

    private static object FindElement(JsonElement p)
    {
        var el = Resolve(p);
        var role = GetString(p, "role");
        var name = GetString(p, "name");
        var automationId = GetString(p, "automationId");
        var walker = Automation.TreeWalkerFactory.GetControlViewWalker();
        var visited = 0;
        var found = WalkFind(el, role, name, automationId, walker, 0, ref visited);
        if (found == null)
            return new { ok = false, error = "no matching element found", visited };

        var key = $"f{++_subReqSeq}";
        _refs[key] = found;
        // Count children for the found element so the caller knows if it's expandable.
        int childCount = 0;
        try
        {
            var c = walker.GetFirstChild(found);
            while (c != null && childCount < DefaultMaxNodes)
            {
                childCount++;
                c = walker.GetNextSibling(c);
            }
        }
        catch { }
        return new { ok = true, element = Describe(key, found, SafeRect(found), false, childCount), visited };
    }

    // Read the full text content of an element that supports TextPattern (e.g. document, editor, terminal).
    private static object GetText(JsonElement p)
    {
        var el = Resolve(p);
        if (!el.Patterns.Text.IsSupported)
            return new { ok = false, error = "Text pattern not supported", name = SafeName(el) };
        var text = el.Patterns.Text.Pattern.DocumentRange.GetText(-1);
        var length = text?.Length ?? 0;
        return new { ok = true, text, length, name = SafeName(el) };
    }

    // Fetch direct children of an element (depth 1 only). Lighter than get_subtree when the agent
    // just wants to see what's inside a container without recursing the entire subtree.
    private static object GetChildren(JsonElement p)
    {
        var el = Resolve(p);
        var max = GetInt(p, "maxChildren", DefaultMaxNodes);
        var walker = Automation.TreeWalkerFactory.GetControlViewWalker();
        var children = new List<object>();
        var winRect = SafeRect(el);
        _subReqSeq++;
        var seq = 0;

        try
        {
            var child = walker.GetFirstChild(el);
            while (child != null && children.Count < max)
            {
                try
                {
                    var key = $"c{_subReqSeq}e{++seq}";
                    _refs[key] = child;
                    // Count grandchildren so the agent knows which children are expandable.
                    int grandchildCount = 0;
                    try
                    {
                        var gc = walker.GetFirstChild(child);
                        while (gc != null && grandchildCount < max)
                        {
                            grandchildCount++;
                            gc = walker.GetNextSibling(gc);
                        }
                    }
                    catch { }
                    children.Add(Describe(key, child, winRect, false, grandchildCount));
                }
                catch { }
                try { child = walker.GetNextSibling(child); }
                catch { break; }
            }
        }
        catch { }

        return new { elements = children, count = children.Count };
    }

    // Return the focus path: the focused element and its ancestors up to the window.
    // Lets the agent understand what's currently active without a full tree snapshot.
    private static object GetFocusTree(JsonElement p)
    {
        var maxDepth = GetInt(p, "maxDepth", 10);
        var focused = Automation.FocusedElement();
        if (focused == null || focused == Automation.GetDesktop())
            return new { ok = false, error = "no focused element" };

        var walker = Automation.TreeWalkerFactory.GetControlViewWalker();
        var chain = new List<AutomationElement>();
        var current = focused;
        for (int d = 0; d < maxDepth && current != null; d++)
        {
            chain.Add(current);
            try { current = walker.GetParent(current); }
            catch { break; }
        }

        _subReqSeq++;
        var elements = new List<object>();
        var seq = 0;
        // Use the nearest ancestor's rect as the viewport hint for offscreen detection.
        var viewRect = SafeRect(chain.Count > 0 ? chain[^1] : focused);

        foreach (var el in chain)
        {
            int childCount = 0;
            try
            {
                var c = walker.GetFirstChild(el);
                while (c != null && childCount < DefaultMaxNodes)
                {
                    childCount++;
                    c = walker.GetNextSibling(c);
                }
            }
            catch { }

            var key = $"z{_subReqSeq}a{++seq}";
            _refs[key] = el;
            elements.Add(Describe(key, el, viewRect, false, childCount));
        }

        var focusRef = elements.Count > 0 ? (elements[0].GetType().GetProperty("ref")?.GetValue(elements[0]) as string) : null;
        return new { ok = true, elements, focusRef };
    }

    // --- Helpers ---

    private static AutomationElement Resolve(JsonElement p)
    {
        var key = p.TryGetProperty("ref", out var r) ? r.GetString() : null;
        if (key == null || !_refs.TryGetValue(key, out var el))
            throw new InvalidOperationException("element no longer available — re-fetch get_ui_tree");
        return el;
    }

    private static AutomationElement ResolveWindow(JsonElement p)
    {
        // Optional explicit window handle — lets callers target a window even when it isn't foreground.
        var hwnd = GetHwnd(p);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("no foreground window");

        var window = Automation.FromHandle(hwnd);
        if (window == null) throw new InvalidOperationException("could not resolve window element");
        return window;
    }

    private static IntPtr GetHwnd(JsonElement p)
    {
        if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty("hwnd", out var hv) && hv.TryGetInt64(out var hraw) && hraw != 0)
            return new IntPtr(hraw);
        return GetForegroundWindow();
    }

    private static string SafeName(AutomationElement el)
    {
        try { return el.Properties.Name.ValueOrDefault ?? ""; }
        catch { return ""; }
    }

    private static System.Drawing.Rectangle SafeRect(AutomationElement el)
    {
        try { return el.Properties.BoundingRectangle.ValueOrDefault; }
        catch { return System.Drawing.Rectangle.Empty; }
    }

    private static string? ValueOrNull(AutomationElement el)
    {
        try { return el.Patterns.Value.IsSupported ? el.Patterns.Value.Pattern.Value.ValueOrDefault : null; }
        catch { return null; }
    }

    private static int GetInt(JsonElement p, string name, int fallback)
    {
        if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.TryGetInt32(out var i))
            return i;
        return fallback;
    }

    private static double GetDouble(JsonElement p, string name, double fallback)
    {
        if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.TryGetDouble(out var d))
            return d;
        return fallback;
    }

    private static string? GetString(JsonElement p, string name)
    {
        if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            return v.GetString();
        return null;
    }
}
