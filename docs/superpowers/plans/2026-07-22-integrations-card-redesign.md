# Integrations Tab Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the dashboard's Integrations tab (`ConnectorMarketplace`, `CustomMcpServers`, `NextStepCard`) from inline-style/row-list to Tailwind cards matching the Home tab's "Plans & credits" card pattern, and remove the now-redundant `ConnectorTheme`/`DARK_THEME`/`LIGHT_THEME` theming system.

**Architecture:** Three presentational components in `packages/ui-connectors/src/components/` currently take a `theme: ConnectorTheme` prop and render with inline `style={{...}}` objects. Each is rewritten to plain Tailwind utility classes using the app's existing shadcn tokens (`border-border`, `bg-card`, `text-foreground`, `bg-primary`, etc. — already used in `DashboardHome.tsx` and the API-key modal in `page.tsx`), and the `theme` prop is dropped. `ConnectorMarketplace`'s tiles move from a bordered row-list to a `grid` of cards. Once all three components no longer need it, the shared `ConnectorTheme` type and its two preset objects are deleted.

**Tech Stack:** Next.js 14 (App Router) + Tailwind CSS 3.4 + React 18, Bun workspaces/Turborepo monorepo. No new dependencies.

## Global Constraints

- No `theme`/`ConnectorTheme` prop on any of the three components after this plan — confirmed via grep that `apps/landing/src/app/dashboard/page.tsx` is the only consumer of `ConnectorTheme`/`DARK_THEME`/`LIGHT_THEME` outside `packages/ui-connectors` itself.
- `packages/ui-connectors` has no `clsx`/`tailwind-merge` dependency and no `@/lib/utils` alias (that's an `apps/landing`-only path) — build conditional class strings with plain template literals/arrays, not a `cn()` helper.
- `packages/ui-connectors` has no `lucide-react` dependency (verified: `icons.tsx` implements every connector icon as a raw inline SVG, no icon library at all) — do not add `lucide-react` to this package for one decorative icon; write a small inline SVG instead.
- Tailwind's `content` glob in `apps/landing/tailwind.config.ts` currently only scans `./src/**/*` — classes written inside `packages/ui-connectors/src` will be silently purged from the production build unless that path is added.
- Custom-MCP helper copy must say "leave empty if the server doesn't require auth" — never "auto-detect" (auto-detecting OAuth is explicitly not built; see `docs/superpowers/specs/2026-07-21-custom-mcp-servers-design.md`).
- No automated test harness exists for React component rendering in `packages/ui-connectors` (confirmed: existing tests only cover pure functions `accountLabel`, `buildCatalog`, `pickNextStep`). Verification for the JSX rewrites is `bun run typecheck` + `bun run lint` + a manual browser check, not new unit tests.
- Full spec: `docs/superpowers/specs/2026-07-22-integrations-card-redesign-design.md`.

---

### Task 1: Add `packages/ui-connectors` to the Tailwind content glob

**Files:**
- Modify: `apps/landing/tailwind.config.ts:5`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new — this is a build-config change other tasks' Tailwind classes rely on being retained in production.

- [ ] **Step 1: Update the `content` array**

In `apps/landing/tailwind.config.ts`, change:

```ts
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
```

to:

```ts
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/ui-connectors/src/**/*.{ts,tsx}"],
```

- [ ] **Step 2: Verify the dev server still starts cleanly**

Run: `cd apps/landing && bun run dev`

Expected: starts without a Tailwind config error, then stop it (Ctrl+C) — this step only confirms the glob syntax is valid, not a full visual check (that happens in Task 6).

- [ ] **Step 3: Commit**

```bash
git add apps/landing/tailwind.config.ts
git commit -m "chore(landing): scan ui-connectors package for tailwind classes"
```

---

### Task 2: Rewrite `ConnectorMarketplace.tsx` as a card grid

**Files:**
- Modify: `packages/ui-connectors/src/components/ConnectorMarketplace.tsx` (full rewrite)
- Modify: `apps/landing/src/app/dashboard/page.tsx` (remove one `theme` prop)

**Interfaces:**
- Consumes: `ConnectorIcon` from `../icons` (unchanged signature: `{ id: string; size?: number }`); `ConnectorCategory`, `ConnectorInfo` from `../types` (unchanged).
- Produces: `accountLabel(displayName?: string): string | undefined` (unchanged signature — `catalog.test.ts` imports this), `ConnectorTile` and `ConnectorMarketplace` components, both now **without** a `theme`/`t` prop. `ConnectorMarketplaceProps` becomes `{ connectors: ConnectorInfo[]; onConnect: (id: string) => void; onDisconnect: (id: string) => void; loadingId?: string | null; limitReached?: boolean; highlightId?: string | null }`.

- [ ] **Step 1: Replace the full contents of `packages/ui-connectors/src/components/ConnectorMarketplace.tsx`**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { ConnectorIcon } from "../icons"
import type { ConnectorCategory, ConnectorInfo } from "../types"

// Display names arrive as "Calendar (someone@gmail.com)" — the connector name is
// already the card title, so only the account is worth the width.
export function accountLabel(displayName?: string): string | undefined {
  if (!displayName) return undefined
  const wrapped = displayName.match(/\(([^)]+@[^)]+)\)/)
  return wrapped ? wrapped[1] : displayName
}

interface ConnectorTileProps {
  info: ConnectorInfo
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loading?: boolean
  limitReached?: boolean
  highlighted?: boolean
}

export function ConnectorTile({
  info,
  onConnect,
  onDisconnect,
  loading,
  limitReached,
  highlighted,
}: ConnectorTileProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const tileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlighted && tileRef.current) {
      tileRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [highlighted])

  function handleDisconnectClick() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      return
    }
    onDisconnect(info.id)
    setConfirmDisconnect(false)
  }

  const account = info.connected ? accountLabel(info.displayName) : undefined

  return (
    <div
      ref={tileRef}
      id={`connector-${info.id}`}
      className={[
        "flex flex-col gap-3 rounded-2xl border p-4 transition-colors",
        highlighted
          ? "border-primary ring-2 ring-primary/40 bg-primary/5"
          : "border-border bg-card hover:border-primary/40",
        !info.available ? "opacity-55" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
            <ConnectorIcon id={info.id} size={17} />
          </div>
          <span className="truncate text-sm font-medium text-foreground">{info.name}</span>
        </div>
        {!info.available && (
          <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            Soon
          </span>
        )}
      </div>

      <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{info.description}</p>

      {info.connected && (
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Connected
          </span>
          {account && (
            <span className="truncate text-[11px] text-muted-foreground" title={account}>
              {account}
            </span>
          )}
        </div>
      )}

      {info.available &&
        (info.connected ? (
          <button
            onClick={handleDisconnectClick}
            onMouseLeave={() => setConfirmDisconnect(false)}
            disabled={loading}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:opacity-50"
          >
            {loading ? "Disconnecting..." : confirmDisconnect ? "Confirm?" : "Disconnect"}
          </button>
        ) : limitReached ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            Limit reached — upgrade to connect
          </span>
        ) : (
          <button
            onClick={() => onConnect(info.id)}
            disabled={loading}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {info.authKind === "api_key"
              ? "Add API key"
              : info.authKind === "connection_string"
                ? "Add connection string"
                : "Connect"}
          </button>
        ))}
    </div>
  )
}

const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  productivity: "Productivity",
  "file-storage": "File Storage",
  "file-management": "File Management",
  email: "Email",
  "data-analytics": "Data & Analytics",
  crm: "CRM",
  communication: "Communication",
  developer: "Developer",
  data: "Databases",
  meetings: "Meetings",
  food: "Food",
  finance: "Finance",
  "customer-support": "Customer Support",
  other: "Other",
}

interface ConnectorMarketplaceProps {
  connectors: ConnectorInfo[]
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loadingId?: string | null
  limitReached?: boolean
  highlightId?: string | null
}

export function ConnectorMarketplace({
  connectors,
  onConnect,
  onDisconnect,
  loadingId,
  limitReached,
  highlightId,
}: ConnectorMarketplaceProps) {
  const categories = Array.from(new Set(connectors.map((c) => c.category)))

  return (
    <div className="flex flex-col gap-8">
      {categories.map((category) => {
        const group = connectors.filter((c) => c.category === category)
        const label = CATEGORY_LABELS[category] ?? category
        const connectedCount = group.filter((c) => c.connected).length

        return (
          <div key={category}>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}
              </span>
              {connectedCount > 0 && (
                <span className="text-xs font-medium text-emerald-400">
                  {connectedCount} connected
                </span>
              )}
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((info) => (
                <ConnectorTile
                  key={info.id}
                  info={info}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  loading={loadingId === info.id}
                  limitReached={limitReached && !info.connected}
                  highlighted={highlightId === info.id}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Remove the `theme` prop from the `ConnectorMarketplace` call site**

In `apps/landing/src/app/dashboard/page.tsx`, find:

```tsx
            <ConnectorMarketplace
              connectors={buildCatalog(
                connectedProviders,
                Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
              )}
              theme={DARK_THEME}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
              highlightId={highlightConnectorId}
            />
```

Remove the `theme={DARK_THEME}` line (leave the `DARK_THEME` import in place — `NextStepCard` and `CustomMcpServers` still use it until Tasks 3 and 4):

```tsx
            <ConnectorMarketplace
              connectors={buildCatalog(
                connectedProviders,
                Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
              )}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
              highlightId={highlightConnectorId}
            />
```

- [ ] **Step 3: Run typecheck, lint, and existing tests**

Run: `bun run typecheck && bun run lint && bun run test`

Expected: all pass. `packages/ui-connectors/src/catalog.test.ts` (which imports `accountLabel` from this file) must still pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/ui-connectors/src/components/ConnectorMarketplace.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(ui-connectors): redesign connector marketplace as a card grid"
```

---

### Task 3: Rewrite `NextStepCard.tsx` with the matching card treatment

**Files:**
- Modify: `packages/ui-connectors/src/components/NextStepCard.tsx`
- Modify: `apps/landing/src/app/dashboard/page.tsx` (remove one `theme` prop)

**Interfaces:**
- Consumes: `ConnectorCategory` from `../types` (unchanged).
- Produces: `pickNextStep(connectedIds: string[]): NextStepSuggestion | null` (unchanged — `NextStepCard.test.ts` imports this), `NextStepCard` component, now taking `{ connectedIds: string[]; appUrl: string }` (no `theme` prop).

- [ ] **Step 1: Replace the full contents of `packages/ui-connectors/src/components/NextStepCard.tsx`**

```tsx
"use client"

import type { ConnectorCategory } from "../types"

export interface NextStepSuggestion {
  id: string
  name: string
  category: ConnectorCategory
  reason: string
}

// Ordered by what unlocks the most value first. Deliberately short — this
// is a "get the essentials connected" nudge, not a completion tracker, so
// it disappears once these are done even if dozens of niche connectors
// remain unconnected. Categories checked against catalog.ts (ui-connectors'
// own ConnectorCategory, not agent-core's differently-shaped type).
const NEXT_STEP_PRIORITY: NextStepSuggestion[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "productivity",
    reason: "Yomi can already read your email — add your calendar so it can schedule things too.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "productivity",
    reason: "Let Yomi search, create, and edit your files, not just email.",
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    reason: "Read and send Slack messages from Telegram.",
  },
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    reason: "Search and update your Notion workspace.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "developer",
    reason: "Check PRs, issues, and repos without leaving the chat.",
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    category: "productivity",
    reason: "Add and check off tasks by just asking.",
  },
  {
    id: "linear",
    name: "Linear",
    category: "productivity",
    reason: "Track and update Linear issues from Telegram.",
  },
]

export function pickNextStep(connectedIds: string[]): NextStepSuggestion | null {
  const connected = new Set(connectedIds)
  return NEXT_STEP_PRIORITY.find((s) => !connected.has(s.id)) ?? null
}

export function NextStepCard({
  connectedIds,
  appUrl,
}: {
  connectedIds: string[]
  appUrl: string
}) {
  const suggestion = pickNextStep(connectedIds)
  if (!suggestion) return null

  return (
    <div className="mb-4 rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">Next step</p>
      <p className="mb-1 text-sm font-semibold text-foreground">Connect {suggestion.name}</p>
      <p className="mb-3 text-xs text-muted-foreground">{suggestion.reason}</p>
      <a
        href={`${appUrl}/dashboard?connect=${suggestion.id}`}
        className="inline-block rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Connect →
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Remove the `theme` prop from the `NextStepCard` call site**

In `apps/landing/src/app/dashboard/page.tsx`, find:

```tsx
            <NextStepCard
              connectedIds={connectedProviders}
              theme={DARK_THEME}
              appUrl={window.location.origin}
            />
```

Replace with:

```tsx
            <NextStepCard connectedIds={connectedProviders} appUrl={window.location.origin} />
```

- [ ] **Step 3: Run typecheck, lint, and existing tests**

Run: `bun run typecheck && bun run lint && bun run test`

Expected: all pass. `packages/ui-connectors/src/components/NextStepCard.test.ts` (imports `pickNextStep`) must still pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/ui-connectors/src/components/NextStepCard.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(ui-connectors): restyle next-step card with tailwind"
```

---

### Task 4: Rewrite `CustomMcpServers.tsx` as a proper labeled-form card

**Files:**
- Modify: `packages/ui-connectors/src/components/CustomMcpServers.tsx` (full rewrite)
- Modify: `apps/landing/src/app/dashboard/page.tsx` (remove the last `theme` prop and the now-unused `DARK_THEME` import)

**Interfaces:**
- Consumes: nothing external beyond React.
- Produces: `CustomMcpServerInfo` (unchanged: `{ id: string; name: string; url: string }`), `CustomMcpServers` component now taking `{ servers: CustomMcpServerInfo[]; onAdd: (input: { name: string; url: string; apiKey: string }) => void; onDelete: (id: string) => void; adding?: boolean; addError?: string }` (no `theme` prop).

- [ ] **Step 1: Replace the full contents of `packages/ui-connectors/src/components/CustomMcpServers.tsx`**

```tsx
"use client"

import { useState, type FormEvent } from "react"

export interface CustomMcpServerInfo {
  id: string
  name: string
  url: string
}

function PlugIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary"
    >
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v3a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  )
}

export function CustomMcpServers({
  servers,
  onAdd,
  onDelete,
  adding,
  addError,
}: {
  servers: CustomMcpServerInfo[]
  onAdd: (input: { name: string; url: string; apiKey: string }) => void
  onDelete: (id: string) => void
  adding?: boolean
  addError?: string
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    onAdd({ name: name.trim(), url: url.trim(), apiKey: apiKey.trim() })
    setName("")
    setUrl("")
    setApiKey("")
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
          <PlugIcon size={16} />
        </div>
        <h2 className="text-sm font-medium text-foreground">Custom MCP servers</h2>
      </div>

      {servers.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.url}</p>
              </div>
              <button
                onClick={() => onDelete(s.id)}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Integration name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My internal tools"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Server URL
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
            API key <span className="normal-case text-muted-foreground/70">(optional)</span>
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave empty if the server doesn't require auth"
            className={inputClass}
          />
        </div>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
        <button
          type="submit"
          disabled={adding}
          className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {adding ? "Connecting..." : "Connect"}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Remove the `theme` prop from the `CustomMcpServers` call site and drop the now-unused `DARK_THEME` import**

In `apps/landing/src/app/dashboard/page.tsx`, find:

```tsx
import {
  ConnectorMarketplace,
  CustomMcpServers,
  NextStepCard,
  buildCatalog,
  DARK_THEME,
  type CustomMcpServerInfo,
} from "@yomi/ui-connectors"
```

Replace with (drop the now-unused `DARK_THEME`):

```tsx
import {
  ConnectorMarketplace,
  CustomMcpServers,
  NextStepCard,
  buildCatalog,
  type CustomMcpServerInfo,
} from "@yomi/ui-connectors"
```

Then find:

```tsx
            <CustomMcpServers
              servers={customServers}
              theme={DARK_THEME}
              onAdd={handleAddCustomMcpServer}
              onDelete={handleDeleteCustomMcpServer}
              adding={customMcpAdding}
              addError={customMcpError}
            />
```

Replace with:

```tsx
            <CustomMcpServers
              servers={customServers}
              onAdd={handleAddCustomMcpServer}
              onDelete={handleDeleteCustomMcpServer}
              adding={customMcpAdding}
              addError={customMcpError}
            />
```

- [ ] **Step 3: Run typecheck, lint, and existing tests**

Run: `bun run typecheck && bun run lint && bun run test`

Expected: all pass — this is the first point where `DARK_THEME` has zero remaining call sites in `page.tsx`, but the export itself still exists in `packages/ui-connectors`, so nothing breaks yet.

- [ ] **Step 4: Commit**

```bash
git add packages/ui-connectors/src/components/CustomMcpServers.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(ui-connectors): rebuild custom mcp servers as a labeled card form"
```

---

### Task 5: Delete the `ConnectorTheme` type system

**Files:**
- Modify: `packages/ui-connectors/src/types.ts`
- Modify: `packages/ui-connectors/src/index.ts`

**Interfaces:**
- Consumes: nothing (this task only removes exports nothing references anymore, per Tasks 2–4).
- Produces: `types.ts` exports only `ConnectorCategory` and `ConnectorInfo`. `index.ts` no longer exports `ConnectorTheme`, `DARK_THEME`, `LIGHT_THEME`.

- [ ] **Step 1: Confirm there are zero remaining references before deleting**

Run: `grep -rn "ConnectorTheme\|DARK_THEME\|LIGHT_THEME" packages/ui-connectors/src apps/landing/src`

Expected: matches only inside `packages/ui-connectors/src/types.ts` and `packages/ui-connectors/src/index.ts` themselves (the definitions/exports being removed in this task) — no other file references them. If any other match appears, stop and update that file first; do not delete the type until this grep is clean.

- [ ] **Step 2: Remove the theme type and presets from `packages/ui-connectors/src/types.ts`**

Delete this whole block (the file keeps `ConnectorCategory` and `ConnectorInfo` above it, unchanged):

```ts
/** Minimal theme tokens used by ConnectorMarketplace. Pass your app's values. */
export interface ConnectorTheme {
  bg: string
  surface: string
  border: string
  borderHi: string
  text: string
  dim: string
  accent: string
  accentText: string
  error: string
  successBg: string
  successBorder: string
  successText: string
  btnBg: string
  btnText: string
  font: string
  backdropFilter?: string
  cardShadow?: string
}

export const DARK_THEME: ConnectorTheme = {
  bg: "rgba(5, 8, 18, 0.4)",
  surface: "rgba(14, 17, 30, 0.6)",
  border: "rgba(255,255,255,0.09)",
  borderHi: "rgba(255,255,255,0.16)",
  text: "#e8e8e8",
  dim: "#888",
  accent: "#2563eb",
  accentText: "#fff",
  error: "#e5534b",
  successBg: "rgba(16,185,129,0.1)",
  successBorder: "rgba(16,185,129,0.2)",
  successText: "#10B981",
  btnBg: "rgba(255,255,255,0.07)",
  btnText: "#ccc",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  backdropFilter: "blur(20px) saturate(160%)",
  cardShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
}

export const LIGHT_THEME: ConnectorTheme = {
  bg: "#ffffff",
  surface: "#f8f8f7",
  border: "rgba(0,0,0,0.12)",
  borderHi: "rgba(0,0,0,0.22)",
  text: "#111",
  dim: "#666",
  accent: "#2563eb",
  accentText: "#fff",
  error: "#dc2626",
  successBg: "rgba(16,185,129,0.08)",
  successBorder: "rgba(16,185,129,0.2)",
  successText: "#059669",
  btnBg: "rgba(0,0,0,0.04)",
  btnText: "#444",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}
```

- [ ] **Step 3: Remove the exports from `packages/ui-connectors/src/index.ts`**

Change:

```ts
export { ConnectorMarketplace, ConnectorTile } from "./components/ConnectorMarketplace"
export { NextStepCard, pickNextStep } from "./components/NextStepCard"
export { CustomMcpServers } from "./components/CustomMcpServers"
export { ConnectorIcon } from "./icons"
export { buildCatalog } from "./catalog"
export type { ConnectorInfo, ConnectorTheme, ConnectorCategory } from "./types"
export type { NextStepSuggestion } from "./components/NextStepCard"
export type { CustomMcpServerInfo } from "./components/CustomMcpServers"
export { DARK_THEME, LIGHT_THEME } from "./types"
```

to:

```ts
export { ConnectorMarketplace, ConnectorTile } from "./components/ConnectorMarketplace"
export { NextStepCard, pickNextStep } from "./components/NextStepCard"
export { CustomMcpServers } from "./components/CustomMcpServers"
export { ConnectorIcon } from "./icons"
export { buildCatalog } from "./catalog"
export type { ConnectorInfo, ConnectorCategory } from "./types"
export type { NextStepSuggestion } from "./components/NextStepCard"
export type { CustomMcpServerInfo } from "./components/CustomMcpServers"
```

- [ ] **Step 4: Run the full verification suite**

Run: `bun run typecheck && bun run lint && bun run test`

Expected: all pass across every workspace package — this is the first point that would surface a missed reference as a real compile error (import of a type/value that no longer exists), not just the scoped checks from earlier tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-connectors/src/types.ts packages/ui-connectors/src/index.ts
git commit -m "refactor(ui-connectors): remove unused ConnectorTheme system"
```

---

### Task 6: Manual browser verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the dashboard locally**

Run: `cd apps/landing && bun run dev`, then sign in and open `/dashboard`, click the **Integrations** tab.

- [ ] **Step 2: Check the connector grid at three widths**

Resize the browser (or use dev tools device toolbar) to confirm: 1 column below the `sm` breakpoint (~640px), 2 columns between `sm` and `lg` (~1024px), 3 columns at `lg` and above. Confirm each card shows icon, name, description (clamped to 2 lines for long descriptions like Dynamics 365's), and a Connect button; connected connectors show the emerald "Connected" badge and, where applicable, the account email.

- [ ] **Step 3: Check the deep-link highlight still works**

Navigate to `/dashboard?connect=notion` (or any connected-but-not-yet id). Confirm the Integrations tab opens, scrolls to the matching card, and that card shows the `ring-2 ring-primary/40` highlight treatment instead of a plain border.

- [ ] **Step 4: Check the Custom MCP servers card**

Scroll to the bottom of the Integrations tab. Confirm it renders as a bordered card matching the Memory/Connections card style on the Home tab, with the three labeled inputs (Integration name / Server URL / API key). Add a test server (any HTTPS URL) and confirm it appears as a row inside the card with a working Remove button.

- [ ] **Step 5: Confirm no regressions on the Home tab**

Switch to the Home tab and confirm the "Plans & credits" cards and "Connections" chip row still render exactly as before — this plan doesn't touch `DashboardHome.tsx`, so this is a quick sanity check, not an expected source of bugs.

- [ ] **Step 6: Report back**

Summarize what was checked and any visual issues found. If everything matches the spec, this plan is complete — no further commit needed for this task since it's verification-only.
