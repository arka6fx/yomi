using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;
using FlaUI.UIA3;

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

    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint MouseRightDown = 0x0008;
    private const uint MouseRightUp = 0x0010;
    private const uint MouseMiddleDown = 0x0020;
    private const uint MouseMiddleUp = 0x0040;

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
        var window = ResolveWindow(p);

        _refs = new Dictionary<string, AutomationElement>();
        var windowId = ++_windowSeq;
        var elements = new List<object>();
        var walker = Automation.TreeWalkerFactory.GetControlViewWalker();
        var winRect = SafeRect(window);

        var elementSeq = 0;
        void Walk(AutomationElement el, int depth)
        {
            if (elements.Count >= maxNodes || depth > maxDepth) return;

            var key = $"w{windowId}e{++elementSeq}";
            _refs[key] = el;
            elements.Add(Describe(key, el, winRect));

            var child = walker.GetFirstChild(el);
            while (child != null && elements.Count < maxNodes)
            {
                Walk(child, depth + 1);
                child = walker.GetNextSibling(child);
            }
        }

        Walk(window, 0);
        return new { window = SafeName(window), elements };
    }

    private static object Describe(string key, AutomationElement el, System.Drawing.Rectangle winRect)
    {
        var rect = SafeRect(el);
        // offscreen = no usable rect, or rect doesn't intersect the window (needs ScrollIntoView/vision).
        var offscreen = rect.Width <= 0 || rect.Height <= 0 || (!winRect.IsEmpty && !winRect.IntersectsWith(rect));
        return new
        {
            @ref = key,
            role = el.Properties.ControlType.IsSupported ? el.ControlType.ToString() : "Unknown",
            name = SafeName(el),
            automationId = el.Properties.AutomationId.ValueOrDefault ?? "",
            rect = new { x = rect.X, y = rect.Y, width = rect.Width, height = rect.Height },
            patterns = SupportedPatterns(el),
            enabled = el.Properties.IsEnabled.ValueOrDefault,
            offscreen,
            value = ValueOrNull(el),
        };
    }

    private static List<string> SupportedPatterns(AutomationElement el)
    {
        var list = new List<string>();
        var pat = el.Patterns;
        if (pat.Invoke.IsSupported) list.Add("Invoke");
        if (pat.Value.IsSupported) list.Add("Value");
        if (pat.Toggle.IsSupported) list.Add("Toggle");
        if (pat.ExpandCollapse.IsSupported) list.Add("ExpandCollapse");
        if (pat.SelectionItem.IsSupported) list.Add("SelectionItem");
        if (pat.Scroll.IsSupported) list.Add("Scroll");
        if (pat.ScrollItem.IsSupported) list.Add("ScrollItem");
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
}
