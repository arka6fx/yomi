# Integrations Tab Card Redesign — Design

Date: 2026-07-22
Status: Approved (design); pending implementation plan

## Summary

Restyle the dashboard's Integrations tab (`ConnectorMarketplace`,
`CustomMcpServers`, `NextStepCard` — all in `packages/ui-connectors`) from
the current hand-rolled inline-style/row-list treatment to Tailwind cards
that match the "Plans & credits" card pattern already on the Home tab
(`apps/landing/src/components/dashboard/DashboardHome.tsx`). The user's own
words: the current tab "is like slop" next to Home, and the Custom MCP
Servers section should become "a proper card" instead of three bare stacked
inputs.

## Supersedes

This reverses two decisions from yesterday's specs, now that the user has
seen the shipped result live rather than a mockup:

- `docs/superpowers/specs/2026-07-21-connections-page-redesign-design.md`
  chose a row-list over a card grid ("the user picked it directly over the
  card option") and explicitly scoped out "unifying the Tailwind (page
  shell) vs. inline-style theme-token (`ui-connectors`) split" as a separate
  concern. Both calls are reversed here: card grid, and the theme split is
  now the thing being unified.
- `docs/superpowers/specs/2026-07-21-custom-mcp-servers-design.md`'s UI
  section said to follow `ConnectorMarketplace.tsx`'s existing inline-style
  pattern ("no new styling system"). Superseded for the same reason.

Everything else in those two specs — category grouping logic, the
`NEXT_STEP_PRIORITY` list and `pickNextStep` function, the `?connect=<id>`
deep-link mechanism, the custom-MCP backend routes/schema/registry wiring,
API-key-header-only auth — is unchanged. This spec is the presentation
layer only.

## Scope (v1)

- **In scope:** `ConnectorMarketplace`/`ConnectorTile` → card grid;
  `CustomMcpServers` → its own bordered card with labeled, restyled inputs;
  `NextStepCard` → matching card treatment; deleting `ConnectorTheme` /
  `DARK_THEME` / `LIGHT_THEME` and the `theme` prop from all three
  components (confirmed via repo-wide grep: `apps/landing/src/app/dashboard/page.tsx`
  is the only consumer of these exports; `landing-page.tsx` and
  `docs/page.tsx` only import `ConnectorIcon`, which is untouched); adding
  `packages/ui-connectors/src` to `apps/landing/tailwind.config.ts`'s
  `content` glob (currently only `./src/**/*` — classes written in the
  package would otherwise be purged from the production build, since
  Tailwind only scans what's listed there).
- **Out of scope:** category taxonomy changes, the API-key/DSN modals in
  `page.tsx` (already Tailwind-styled, not touched), any backend/schema/
  routes work, a light-theme variant (the dashboard has no theme toggle —
  confirmed no `next-themes`/`ThemeProvider` in the app — so `.dark` CSS
  vars are the only ones that matter; `LIGHT_THEME` was already dead weight
  before this change).

## Rejected approaches

- **Row-list, just restyled in Tailwind.** Rejected: the whole point of
  this pass is to match the Home tab's plan-card look the user pointed at;
  a Tailwind row list would still not look like that reference.
- **Keep the `theme` prop but source its values from CSS vars instead of
  literals** (e.g. `DARK_THEME` built from `getComputedStyle`). Rejected as
  needless indirection — there is exactly one consumer, it's already inside
  a Tailwind app with the full shadcn token set available as classes, and
  carrying a parallel theme object forward serves no one.

## Design

### 1. Tailwind content glob (`apps/landing/tailwind.config.ts`)

```ts
content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/ui-connectors/src/**/*.{ts,tsx}"],
```

Without this, every Tailwind class introduced in the package below is
correctly rendered in dev (where Next.js's Tailwind plugin resolves the
monorepo workspace) but silently dropped from the production CSS bundle,
since Tailwind's JIT scanner only extracts classes from paths in `content`.

### 2. Drop the theme system (`packages/ui-connectors/src/types.ts`, `index.ts`)

Delete `ConnectorTheme`, `DARK_THEME`, `LIGHT_THEME` and their exports.
`ConnectorInfo`/`ConnectorCategory` are untouched — only the theme-token
types go. Every component below takes no `theme` prop; styling is inline
Tailwind classes using the app's existing tokens (`border-border`,
`bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`,
`text-primary-foreground`, `bg-primary/10`, etc. — the exact set already
used in `DashboardHome.tsx` and the API-key modal in `page.tsx`).

### 3. `ConnectorMarketplace` → card grid

Category grouping loop is unchanged (iterate categories present in
`connectors`, header with "N connected" count). The header becomes:

```tsx
<div className="mb-3 flex items-center gap-2.5">
  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
    {label}
  </span>
  {connectedCount > 0 && (
    <span className="text-xs font-medium text-emerald-400">{connectedCount} connected</span>
  )}
  <span className="h-px flex-1 bg-border" />
</div>
```

Connector list per category becomes a grid:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
  {group.map((info) => <ConnectorTile key={info.id} info={info} ... />)}
</div>
```

`ConnectorTile` becomes a card, structurally mirroring the plan-card in
`DashboardHome.tsx` (icon+name row, content, action row at the bottom):

```tsx
<div
  id={`connector-${info.id}`}
  className={cn(
    "flex flex-col gap-3 rounded-2xl border p-4 transition-colors",
    highlighted ? "border-primary ring-2 ring-primary/40 bg-primary/5" : "border-border bg-card hover:border-primary/40",
    !info.available && "opacity-55",
  )}
>
  <div className="flex items-start justify-between gap-2">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
        <ConnectorIcon id={info.id} size={17} />
      </div>
      <span className="text-sm font-medium text-foreground truncate">{info.name}</span>
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
      {accountLabel(info.displayName) && (
        <span className="truncate text-[11px] text-muted-foreground" title={accountLabel(info.displayName)}>
          {accountLabel(info.displayName)}
        </span>
      )}
    </div>
  )}

  {info.available && (
    info.connected ? (
      <button onClick={handleDisconnectClick} disabled={loading}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:opacity-50">
        {loading ? "Disconnecting..." : confirmDisconnect ? "Confirm?" : "Disconnect"}
      </button>
    ) : limitReached ? (
      <span className="text-[11px] font-medium text-muted-foreground">Limit reached — upgrade to connect</span>
    ) : (
      <button onClick={() => onConnect(info.id)} disabled={loading}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
        {info.authKind === "api_key" ? "Add API key" : info.authKind === "connection_string" ? "Add connection string" : "Connect"}
      </button>
    )
  )}
</div>
```

`accountLabel()` (already exported, extracts the email from
`"Calendar (someone@gmail.com)"`) and the `highlighted`/scroll-into-view
`useEffect` are unchanged — this is styling only, not a props/behavior
change, so the `?connect=<id>` deep-link and Telegram-nudge integration
keep working exactly as before.

Not-yet-connectable connectors (currently just Swiggy, `available: false`)
still render in the grid at reduced opacity with a "Soon" badge, same as
today — removing them from view would make deep-linked
`?connect=swiggy` (if ever sent) land on a blank category.

### 4. `CustomMcpServers` → dedicated card

Placed below the connector grid, matching the Home tab's card shell
exactly (`rounded-2xl border border-border bg-card p-5 sm:p-6`, icon-chip
header):

```tsx
<div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
  <div className="mb-4 flex items-center gap-2.5">
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
      <Plug size={16} className="text-primary" />
    </div>
    <h2 className="text-sm font-medium text-foreground">Custom MCP servers</h2>
  </div>

  {servers.length > 0 && (
    <div className="mb-4 flex flex-col gap-2">
      {servers.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
            <p className="truncate text-xs text-muted-foreground">{s.url}</p>
          </div>
          <button onClick={() => onDelete(s.id)}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive">
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
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My internal tools"
        className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
    </div>
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Server URL
      </label>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp"
        className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
    </div>
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
        API key <span className="normal-case text-muted-foreground/70">(optional)</span>
      </label>
      <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Leave empty if the server doesn't require auth"
        className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
    </div>
    {addError && <p className="text-xs text-destructive">{addError}</p>}
    <button type="submit" disabled={adding}
      className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
      {adding ? "Connecting..." : "Connect"}
    </button>
  </form>
</div>
```

Same helper-text wording constraint as the original custom-MCP spec: "leave
empty if the server doesn't require auth," never "auto-detect" (that's
still not built). `Plug` is already imported in `page.tsx`'s icon set;
`CustomMcpServers.tsx` gains its own `import { Plug } from "lucide-react"`.

### 5. `NextStepCard` → card treatment

Same accent-tinted-card idea as today, expressed in Tailwind instead of
`t.accent`-derived inline styles:

```tsx
<div className="mb-4 rounded-2xl border border-primary/40 bg-primary/5 p-4">
  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">Next step</p>
  <p className="mb-1 text-sm font-semibold text-foreground">Connect {suggestion.name}</p>
  <p className="mb-3 text-xs text-muted-foreground">{suggestion.reason}</p>
  <a href={`${appUrl}/dashboard?connect=${suggestion.id}`}
    className="inline-block rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
    Connect →
  </a>
</div>
```

`pickNextStep`/`NEXT_STEP_PRIORITY` unchanged — pure logic, no styling.

### 6. Wiring (`apps/landing/src/app/dashboard/page.tsx`)

Drop `theme={DARK_THEME}` from the three call sites
(`<NextStepCard>`, `<ConnectorMarketplace>`, `<CustomMcpServers>`) and the
now-unused `DARK_THEME` import. No other changes — `connectedProviders`,
`integrationHealth`, `customServers`, and all the connect/disconnect/add/
delete handlers are untouched.

## Testing

- `catalog.test.ts` and `NextStepCard.test.ts` don't touch styling/theme
  (confirmed by grep) — should pass unchanged.
- `bun run typecheck` across `packages/ui-connectors` and `apps/landing`
  (removing exports from `index.ts` is a type-surface change; anything
  outside this scope that imported `ConnectorTheme`/`DARK_THEME`/
  `LIGHT_THEME` would fail to compile — grep confirmed there is no such
  caller today, but typecheck is the backstop).
- `bun run lint`.
- No component test harness exists for this package (same limitation noted
  in the prior two specs) — verify visually with the dev server. Per
  `AGENTS.md`'s UI-change guidance, actually load the Integrations tab in a
  browser before calling this done: check the card grid at mobile (1
  column), tablet (2), and desktop (3) widths, confirm the `?connect=<id>`
  highlight/scroll-into-view still works on a connector card, and confirm
  the Custom MCP form add/remove round-trip still works end-to-end.

## Migration reminder

None — no schema/backend changes in this spec.
