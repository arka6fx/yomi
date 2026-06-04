# uia-helper

Windows UI Automation helper for Yomi (Spec 16). A small self-contained .NET
console app (FlaUI / UIA3) that the Bun sidecar spawns and drives over
**JSON-RPC, line-delimited on stdio** (one JSON object per line in, one per line
out). It exists as a separate process because Bun can't reliably load native UIA
node addons; .NET talks to UI Automation directly.

## Methods

| method           | params                     | result                                                                       |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `ping`           | —                          | `{ ok: true }`                                                               |
| `get_ui_tree`    | `{ maxNodes?, maxDepth? }` | `{ window, elements: UiaElement[] }` — control view of the foreground window |
| `invoke_element` | `{ ref }`                  | `{ ok, role, name }` — InvokePattern (or click fallback)                     |
| `set_value`      | `{ ref, text }`            | `{ ok, name, before, after }` — ValuePattern (or focus+type)                 |
| `toggle_element` | `{ ref }`                  | `{ ok, name, before, after }` — TogglePattern                                |
| `click_point`    | `{ x, y, button? }`        | `{ ok, x, y }` — coordinate fallback for UIA-blind apps                      |

`ref` (`w<window>e<element>`) is stable only within the latest `get_ui_tree`
snapshot. If an action returns "element no longer available", re-fetch the tree.
Rects are physical screen pixels.

## Build

```bash
dotnet build -c Release
# self-contained single .exe (no .NET install needed on the user's machine):
dotnet publish -c Release -r win-x64 -p:PublishSingleFile=true --self-contained -o dist
```

## Quick test

```powershell
'{"id":1,"method":"ping"}' | .\dist\uia-helper.exe
```
