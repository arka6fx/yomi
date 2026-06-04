# Spec 17 - Browser Automation via Playwright (MCP)

## Purpose

Give Yomi real browser automation: navigate sites, click/type, fill and submit
web forms, log in, wait for dynamic content, and extract structured data — the
things the accessibility-tree UIA path (Spec 16) and the read-only
`fetch_url`/`web_search` tools cannot do reliably.

Today "browser" work is one of two weak things:

- **UIA** drives Chrome/Edge as a generic Windows app (`Ctrl+L` → address bar →
  click links in the accessibility tree). Fine for "open this site, click that
  link"; fragile for multi-step flows, SPAs, forms, waiting, multi-tab, and
  extraction.
- **`fetch_url` / `web_search`** (`apps/sidecar/src/tools/web.ts`) read page
  text — no interaction, no JS.

AGENTS.md already commits to "MCP servers … browser" as part of the agent
harness, and `.mcp.json` lists `@playwright/mcp` — but that file configures the
Claude Code dev tool, **not** Yomi's sidecar, which has **no MCP client at all**
(`apps/sidecar/src/tools/index.ts` loads only memory/system/web). This spec adds
a **generic MCP client** to the sidecar and wires the **Playwright MCP** server
through it, reusable later for the planned calendar/email/Slack servers.

## Locked Decisions

1. **Dedicated browser, persistent profile.** The sidecar drives its own
   Chromium via Playwright MCP, with a persistent `--user-data-dir`
   (`~/.yomi/browser-profile`) so logins/cookies survive across runs.
   **Headed**, so the user can see Yomi act (privacy: visible status). The
   user's everyday Chrome is _not_ driven by Playwright — UIA still handles the
   browser window the user is looking at.
2. **Playwright MCP via a generic MCP client.** Use the AI SDK's
   `experimental_createMCPClient` + `Experimental_StdioMCPTransport`
   (`ai/mcp-stdio`) to spawn `@playwright/mcp` over stdio and merge its tools
   into the agent loop. One generic client so future MCP servers plug in the
   same way.
3. **Split routing.** Web tasks (URLs, websites, multi-step flows, extraction) →
   Playwright's browser; "act on the browser window I'm looking at" → UIA. The
   agent chooses via prompt guidance.
4. **Same safety model as Act mode.** Risky browser actions
   (buy/pay/submit/delete/send, file upload) reuse the Spec 16 confirm channel
   (`act_proposed` → desktop yes/no). Banking / password-manager domains are
   refused outright.

## Architecture

```
apps/sidecar (Bun)   agent ReAct loop
  │  local tools (memory/system/web)  +  MCP tools (browser_*)
  │  ▲ tools merged in agentPipeline, wrapped by the safety guard, then applyHooks
  ▼
apps/sidecar/src/mcp/client.ts  ── stdio (MCP) ──►  @playwright/mcp (node CLI)
                                                      └─► Chromium (headed, persistent profile)
```

The MCP server is spawned lazily on the first full agent turn and reused
(singleton); the Chromium window opens only when the first `browser_*` tool
runs. If the server can't start (offline, missing browser), `getMcpTools()`
returns `{}` and the agent degrades to UIA / `fetch_url`.

## New Files

- `apps/sidecar/src/mcp/client.ts` — generic MCP client manager. `getMcpTools()`
  connects once (`experimental_createMCPClient` +
  `Experimental_StdioMCPTransport`) and caches the tool set; `closeMcp()` tears
  down the client + browser. Spawn command defaults to the locally-installed
  `@playwright/mcp/cli.js` run under the current runtime, overridable via
  `YOMI_MCP_PLAYWRIGHT_CMD`.
- `apps/sidecar/src/mcp/safety.ts` — `wrapBrowserTools(tools)` gates risky
  `browser_*` actions through `requestConfirmation` (act-bus) and refuses
  blocklisted domains on `browser_navigate`. `classifyBrowserRisk(name, args)`
  is the pure, unit-tested risk decision.

## Playwright MCP tool surface (consumed, not authored)

`browser_navigate`, `browser_navigate_back`, `browser_snapshot` (accessibility
tree with refs), `browser_click` (`{element, ref}`), `browser_type`
(`{element, ref, text, submit?}`), `browser_fill_form`, `browser_select_option`,
`browser_press_key`, `browser_hover`, `browser_drag`, `browser_file_upload`,
`browser_wait_for`, `browser_take_screenshot`, `browser_tabs`,
`browser_evaluate`, `browser_handle_dialog`, `browser_close`. The
snapshot→ref→act model mirrors UIA, so the agent's discipline ("re-snapshot
after navigation; refs are per-snapshot") carries over.

## Sidecar Behavior

### MCP client (`mcp/client.ts`)

Lazily-started singleton mirroring `uia/client.ts`. `getMcpTools()` is awaited
in `agentPipeline` **only for the full agent loop** (after the
volume/Spotify/WhatsApp fast-path early returns), so simple system actions never
spawn the browser. Failure is cached as `{}` for the process lifetime (a sidecar
restart clears it).

### Tool wiring (`pipeline/agent.ts`)

`const tools = applyHooks({ ...createAgentTools(...), ...wrapBrowserTools(await getMcpTools()) })`.
Merging **before** `applyHooks` means browser tools also pass the PreToolUse
denylist and the PostToolUse output-trim (browser snapshots are large — the trim
matters).

### Safety (`mcp/safety.ts`, reuses `uia/safety.ts` + `uia/act-bus.ts`)

- `browser_navigate` to a banking / password-manager domain → hard refusal
  (`isBlockedDomain`).
- `browser_file_upload` → always confirm.
- `browser_click` / `browser_type` / `browser_fill_form` /
  `browser_select_option` → confirm when the target `element` description or
  typed text matches destructive verbs (`isDestructiveText`, the same
  `RISKY_LABEL` used for UIA).
- Confirmation reuses `requestConfirmation` → `act_proposed` → desktop yes/no
  (`setActEmitter` is already wired in `agentPipeline`), so **no new desktop
  plumbing** — browser confirms use the existing Act-mode Yes/No UI.

### Prompt (`harness/prompt.ts`)

New `<browser_automation>` block: navigate → snapshot → act by ref →
re-snapshot; `browser_*` for web tasks, UIA only for the user's visible browser;
prefer snapshot over screenshot for reading; risky steps auto-confirm;
blocklisted sites refused.

### Lifecycle (`index.ts`)

`closeMcp()` on `SIGINT`/`SIGTERM`/`beforeExit` so Chromium + the MCP child exit
cleanly.

## Routing & Tier

The existing intent router already sends imperative/automation commands to the
agent path. Browser automation rides that path → **Max** tier (agents are Max
per AGENTS.md). No new gate.

## Build & Packaging

- Dev: `@playwright/mcp` is a sidecar dependency. It bundles a **pinned**
  Playwright (currently `1.61.0-alpha`), so its Chromium must be installed with
  **that** CLI, not the repo's other Playwright:
  `bun <node_modules/.bun/playwright@<pinned>/.../playwright/cli.js> install chromium`
  (downloads `chromium-<rev>` + `chromium_headless_shell-<rev>` into
  `~/AppData/Local/ms-playwright`). Verified working: agent → `browser_navigate`
  → `browser_snapshot` → answered example.com's H1. `YOMI_MCP_PLAYWRIGHT_CMD`
  can override the launch (e.g. `npx -y @playwright/mcp`).
- Shipped desktop app (**follow-up**, like the UIA helper staging): bundle
  `@playwright/mcp` + a Chromium build via electron-builder `extraResources`,
  and point the sidecar at them (env override), so no post-install download is
  needed. Adds ~150 MB.

## Tests

- `apps/sidecar/src/mcp/safety.test.ts` — `classifyBrowserRisk`: file upload
  risky; destructive click/type labels risky; ordinary navigation/click safe;
  `isBlockedDomain` refuses banking hosts.
- An MCP connect / tools-merge test is **env-gated** (`YOMI_MCP_E2E=1`) and
  skipped in CI — it needs to spawn the server and download/launch a browser.

## Verification

CI gates stay green: `bun run lint`, `bun run build:ci`, `bun run typecheck`,
`bun run test`.

Manual e2e (sidecar running, plan `max`):

1. "open example.com and read me the heading" → `browser_navigate` +
   `browser_snapshot`, answer.
2. "search Hacker News and summarise the top story" → multi-step
   navigate/snapshot/extract.
3. Risky: "…and buy it" → `act_proposed` (risky:true), nothing happens until
   confirmed.
4. Blocklist: navigating to a bank domain is refused before the page loads.
5. Degradation: with the browser MCP unavailable, the agent falls back to
   `fetch_url`/UIA without crashing.

## Implementation Order

1. `@playwright/mcp` dependency.
2. `mcp/client.ts` (generic client + lazy connect + close).
3. `mcp/safety.ts` (`wrapBrowserTools`, `classifyBrowserRisk`) + `uia/safety.ts`
   helpers (`isBlockedDomain`, `isDestructiveText`).
4. `pipeline/agent.ts` merge (deferred to the agent loop), `harness/prompt.ts`
   block, `index.ts` shutdown.
5. Tests + gates.

## Files

- `specs/17-browser-automation.md` (this doc)
- `apps/sidecar/src/mcp/client.ts`, `apps/sidecar/src/mcp/safety.ts` (new) +
  `mcp/safety.test.ts`
- `apps/sidecar/src/pipeline/agent.ts`, `apps/sidecar/src/harness/prompt.ts`,
  `apps/sidecar/src/index.ts`, `apps/sidecar/src/uia/safety.ts`,
  `apps/sidecar/package.json`

## Future Work

- Bundle Chromium + the MCP server for the packaged desktop app (remove the dev
  npx/download path).
- Optional CDP-attach mode to drive the user's _visible_ Chrome (needs
  `--remote-debugging-port`; weigh Chrome 136+ default-profile restrictions and
  the security trade-off).
- Surface a visible "Yomi is using the browser" status pill in the desktop
  overlay.
- Wire the remaining MCP servers (calendar/email/Notion/Slack) through the same
  client.
