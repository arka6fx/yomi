# Spec 25 - Spotify Desktop Automation

## Purpose

Define how Yomi controls Spotify Desktop on Windows through voice/type
commands, the validation framework that proves it works, and the certification
criteria that gates releases.

Spotify is unique among automation targets because it renders its UI inside a
WebView2 control rather than native Win32/WPF widgets. This changes which
automation patterns work and which fallbacks are needed.

## Architecture

```
USER VOICE → intent router → agent pipeline → Spotify tools → UIA helper → Spotify Desktop
                                                                  ↕
                                                            Core Audio API
                                                          (volume, ducking)
```

### Four-layer automation stack

| Layer | Technology | File | Role |
|-------|-----------|------|------|
| C# UIA helper | FlaUI over UIA3, NAudio | `apps/uia-helper/Program.cs` | Raw UIA tree, Win32 input, Core Audio |
| Bun UIA client | JSON-RPC over stdio | `apps/sidecar/src/uia/client.ts` | RPC marshalling, tree diff, reResolve |
| Act executor | TypeScript | `apps/sidecar/src/uia/act-executor.ts` | Plan → execute → validate → recover |
| Agent tools | Vercel AI SDK `tool()` | `apps/sidecar/src/tools/system.ts` | LLM-facing tool definitions |

### Spotify-specific agent scoping

`apps/sidecar/src/automation/agents/spotify.ts` restricts tool access to four
tools when the intent classifier determines the goal is music-related:

```
play_spotify, control_spotify, adjust_spotify_volume, look_at_screen
```

### Shortcut dispatch

Before reaching the LLM agent loop, the pipeline checks shortcut patterns in
`apps/sidecar/src/pipeline/shortcuts.ts`:

| Pattern | Function | Route |
|---------|----------|-------|
| "play X on spotify" | `spotifyPlaybackQuery()` | → `playSpotify()` |
| "next/previous/stop" | `playbackControl()` | → `controlSpotifyPlayback()` |
| "volume up/down/mute" | `volumeAction()` | → `adjustSpotifyVolume()` |

## Tool Reference

### `play_spotify`
- Opens Spotify if not running (PowerShell `Start-Apps`)
- Brings window to foreground
- Focuses search bar via Ctrl+L
- Types query and submits
- Waits for results, finds top play button
- Invokes play via UIA (with coordinate fallback)

### `control_spotify`
- Maps pause/resume/next/previous/stop to Win32 media keys via `keybd_event`
- **Focus-free** — works with Spotify in background
- Does not use the UIA tree at all

### `adjust_spotify_volume`
- Uses NAudio `MMDeviceEnumerator` → `SimpleAudioVolume` by PID
- **Focus-free, invisible** — no window interaction needed
- Returns 0.0–1.0 scale, verified by reading back after set

### `adjust_volume` (system)
- Win32 `keybd_event` with VK_VOLUME codes
- Changes Windows master volume, not per-app

### Ducking (`POST /spotify/duck`)
- Called automatically when Yomi starts listening
- Ducks Spotify to 12% volume, restores afterwards
- Implemented in `apps/desktop/src/main/index.ts:422` calling
  `apps/sidecar/src/index.ts:300`

## UIA Interaction Patterns

Spotify's WebView2 UI requires specific patterns because standard UIA widgets
are unavailable:

### What works (verified)

| Pattern | Method | Success rate |
|---------|--------|-------------|
| Window detection | `findWindow({ process: "Spotify" })` | 100% |
| Foreground/background | `setForeground(hwnd)` | 100% |
| Media keys | `mediaKey("play_pause")` | 100% |
| Keyboard simulation | `press_key({ keys: "Ctrl+L" })` | 100% |
| UIA tree snapshot | `getUiTree({ lite: true })` | 100% (200-1200 nodes) |
| Button invoke | `invoke_element({ ref })` | ~90% (stale refs) |
| Coordinate click (fallback) | `click_point({ x, y })` | ~95% |
| Core Audio volume | `getAppVolume` / `setAppVolume` | 100% |
| Re-snapshot reResolve | `reResolve(ref)` | ~80% on stale refs |

### What has caveats

| Feature | Limitation |
|---------|-----------|
| Search bar detection | WebView2 renders the search field internally; UIA exposes no native Edit control. Yomi uses Ctrl+L keyboard shortcut instead |
| Scroll pattern | WebView2 containers do not expose the UIA Scroll pattern. Content scrolls via mouse wheel or touch |
| Pause button | Spotify uses a single toggle "Play" button. When playing, clicking "Play" pauses it. No separate "Pause" button exists in UIA |
| Element naming | WebView2 elements use display text as names which may be truncated or change with locale |

### The `findSpotifyResultRow()` algorithm

```typescript
// From apps/sidecar/src/tools/system.ts:380-439
function findSpotifyResultRow(elements, query):
  1. Parse query into tokens via parseSpotifyQuery() ("X by Y" → track, artist)
  2. Score each row by token overlap using tokenScore()
  3. Return best-matching row above threshold
```

## Validation Framework

### Architecture

`apps/sidecar/src/uia/spotify.e2e.test.ts` — self-validating E2E tests using
bun:test. Every interaction chain follows:

```
execute action → snapshot state → assert condition → capture evidence
```

### Evidence types collected

- Screenshots (full-screen via `captureScreen`, window-only via `windowScreenshot`)
- UI tree snapshots (200-1200 elements, role/name/rect/enabled/offscreen)
- Volume readings (Core Audio, precise to 0.01)
- Media key responses (JSON `{ ok: true, key: "next" }`)
- Element counts (matches, play buttons, queue items)
- Timing data (each test captures duration)

### Phase S1 test suite

`audit/spotify/audit.ts` — 18 tests that exercise every Spotify interaction:

| # | Test | Verifies |
|---|------|----------|
| 1 | Launch Spotify | Window detection, foreground, UI tree |
| 2 | Search | Ctrl+L focus, text entry, result enumeration |
| 3 | Play song | Play button discovery, UIA invoke, now-playing indicators |
| 4 | Pause | Media key routing, state change |
| 5 | Resume | Media key, playback continuity |
| 6 | Next track | Media key "next", track change |
| 7 | Previous track | Media key "previous", track change |
| 8 | Volume control | 25%, 50%, mute, restore — verified by reading back |
| 9 | Playlist discovery | Library navigation, playlist enumeration |
| 10 | Play specific playlist | Library item selection |
| 11 | Shuffle | Shuffle toggle invoke |
| 12 | Repeat | Repeat state detection |
| 13 | Scroll validation | Home/Search/Library navigation |
| 14 | Queue access | Queue button invoke, item enumeration |
| 15 | Device selection | "Connect to a device" detection |
| 16 | Ambiguous music request | Multiple-result handling |
| 17 | Recovery | Window close → detect → re-launch |
| 18 | Accessibility inventory | Full control enumeration to JSON |

## Certification Criteria

Spotify Desktop control passes certification only when **all** of the following
are met:

1. **Search works** — Ctrl+L → type → Enter → results appear in tree
2. **Playback works** — Play button invoke → now-playing indicators appear
3. **Transport works** — media keys pause/resume/next/previous respond
4. **Volume works** — Core Audio set-and-verify at both extremes
5. **Navigation works** — Home/Search/Library all accessible
6. **Playlist selection works** — Library enumeration → item click
7. **Ambiguity handling works** — Multi-result queries detected
8. **Recovery works** — Process crash → detect → re-launch
9. **Evidence exists** — Screenshots, logs, and controls inventory saved

No API success alone counts as validation. Every passing test requires
objective state verification.

## Self-Learning UIA Memory

Spotify tests include a self-learning layer in
`apps/sidecar/src/uia/spotify.e2e.test.ts:245-264` that remembers successful
interaction patterns:

```typescript
interface LearnedAction {
  app: string        // "spotify"
  goal: string       // "play_song", "skip_ads", "go_home"
  strategy: string   // "Ctrl+L_search_play_top_result"
  elementPattern: { role: string; nameRegex: string }
  lastUsed: number
}
```

Learned actions persist for the session and are recallable by goal. New
strategies are added when novel UIA patterns succeed.

Example learned patterns from Phase S1:

| App | Goal | Strategy |
|-----|------|----------|
| spotify | skip_ads | close_button_or_Escape |
| spotify | play_podcast | play_button_near_episode_row |
| spotify | search_podcast | Ctrl+L_search_click_show_row |
| spotify | play_song | Ctrl+L_search_play_top_result |
| spotify | go_home | sidebar_button_or_Alt+Home |

## Limitations & Known Issues

1. **WebView2 scroll pattern** — Spotify's content panes don't expose UIA
   ScrollPattern. The `scroll_element` tool returns "Scroll pattern not
   supported". Users must use mouse wheel or touch scrolling.

2. **No native Edit control** — The search bar is rendered inside WebView2 and
   not exposed as a UIA Edit element. Yomi uses Ctrl+L which correctly focuses
   the search bar within the web view.

3. **Toggle play/pause** — Spotify exposes a single "Play" button. When
   playing, clicking it pauses. The UIA name (\`"Play"\`) doesn't change to
   "Pause". State is inferred from context (now-playing indicators, progress
   bar position).

4. **Repeat button conditional** — The repeat button only appears in the UI
   tree when a playlist/album/queue context is active. On the Home screen it
   is absent.

5. **Free tier ads** — Audio ads on the free tier cannot be skipped. Visual ad
   overlays can be dismissed via close buttons or Escape key. Ad detection
   uses window title heuristics in `isAdPlaying()`.

6. **Volume initial null** — When Spotify has no active audio session (no
   song loaded/playing), `getAppVolume` returns null. A playback command must
   be issued first to establish the audio session.

7. **Element staleness** — WebView2 recreates elements when the page
   re-renders. References captured before a navigation event become stale.
   The `reResolve()` method matches by automationId → exact name+role → fuzzy
   name+role to recover.

## Verification

```bash
# Run the E2E test suite (requires Windows + Spotify Desktop)
bun test apps/sidecar/src/uia/spotify.e2e.test.ts

# Run the Phase S1 audit (18 tests with full evidence capture)
$env:YOMI_UIA_HELPER = "path\to\uia-helper.exe"
cd apps/sidecar
bun run ../audit/spotify/audit.ts

# Run the accessibility inventory separately
bun run ../audit/spotify/inventory.ts
```

## Future Work

1. **Progress bar reading** — Extract current playback position from WebView2
   via accessibility text or OCR
2. **Like/unlike track** — Invoke "Add to Liked Songs" button
3. **Follow artist** — Navigate to artist page and follow
4. **Free-tier ad auto-skip timer** — Wait-and-retry with volume duck
5. **Playlist create/rename** — Library panel automation
6. **Crossfade / audio quality settings** — Settings panel automation
7. **Podcast seek** — 15-second skip forward/back buttons
8. **Lyrics panel** — Open/close lyrics view
9. **Native Spotify Web API fallback** — Use OAuth + Web API for operations
   that the desktop app's WebView2 cannot expose
