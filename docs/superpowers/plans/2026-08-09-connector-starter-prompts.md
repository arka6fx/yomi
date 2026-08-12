# Connector Starter Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user connects a connector, show them 1-3 concrete example
prompts for that connector on its dashboard card, and have Yomi proactively send
the same prompts on Telegram shortly after the connection completes.

**Architecture:** A single shared data file
(`packages/shared/src/starter-prompts.ts`) is consumed by two independent
surfaces: the dashboard's `ConnectorTile` component (immediate, synchronous) and
a new debounced backend sweep (`connector-nudge.ts`) that fires a Telegram
message ~5 minutes after a genuinely new connector connection, reusing the
existing 60-second cron infrastructure that already runs `runDueSchedules`.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Hono, React (Next.js
dashboard), Bun test.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-connector-starter-prompts-design.md`
- Coverage: every connector with `available: true` in
  `packages/ui-connectors/src/catalog.ts` gets a `STARTER_PROMPTS` entry (57
  connectors). `google-photos` and `swiggy` are `available: false` and excluded.
- No retroactive nudges: only a genuinely new `mcpConnections` row triggers the
  Telegram nudge, never a reconnect/token-refresh.
- Telegram nudge delivery is a template fill, never an agent run — free,
  uncharged, matching `soul.ts`'s onboarding-turn convention.
- Debounce window: 5 minutes, fixed from the first connect in a burst
  (`NUDGE_DEBOUNCE_MS = 5 * 60 * 1000` in `connector-nudge.ts`).
- Message cap: at most 3 prompts total per Telegram nudge (1 per connector if
  multiple connected in one burst, up to 2 if just one).
- Test each function at the level this codebase already tests its neighbors at:
  pure logic (state-machine decisions, message formatting) gets plain unit
  tests, matching `soul.ts`'s `decideSoulOnboarding` and `composio-connect.ts`'s
  `isRowConnected`. A DB-touching function whose _correctness_ is the point
  (e.g. "does this correctly distinguish a new connection from a reconnect")
  gets a `mock.module("@yomi/db", ...)` test, matching
  `admin-explore-reset.test.ts`'s existing pattern — this is what Tasks 7-8 do
  for `wasNewConnection`. A DB-touching _sweep_ function (batch-scans a table,
  fires side effects for each due row) follows `schedule-runner.ts`'s
  `runDueSchedules`, which has no dedicated test file in this codebase — Task
  6's `runDueConnectorNudges` follows that same precedent and is exercised only
  via Task 10's manual check, not because DB code is untestable in general, but
  because sweep functions specifically aren't unit-tested here today.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), lowercase,
  no full stop, max 72 chars.
- Migrations are a manual step: `bun run db:migrate` must be run from
  `packages/db` after Task 4 lands, separately from the code deploy (per project
  convention — code deploys automatically on push to `main`, migrations do not).

---

### Task 1: Shared starter-prompts catalog

**Files:**

- Create: `packages/shared/src/starter-prompts.ts`
- Create: `packages/shared/src/starter-prompts.test.ts`
- Modify: `packages/shared/src/index.ts` (add re-export)
- Modify: `packages/shared/package.json` (add `./starter-prompts` export path)

**Interfaces:**

- Produces: `export const STARTER_PROMPTS: Record<string, string[]>` — keyed by
  connector id (matches `ConnectorInfo.id` / `ConnectorDef.id`). Every value is
  a non-empty array of 1-2 non-empty strings.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/starter-prompts.test.ts
import { describe, expect, it } from "bun:test"
import { STARTER_PROMPTS } from "./starter-prompts.js"

describe("STARTER_PROMPTS", () => {
  it("has at least one connector entry", () => {
    expect(Object.keys(STARTER_PROMPTS).length).toBeGreaterThan(0)
  })

  it("every entry is a non-empty array of non-empty, trimmed strings", () => {
    for (const [id, prompts] of Object.entries(STARTER_PROMPTS)) {
      expect(prompts.length, `${id} has no prompts`).toBeGreaterThan(0)
      expect(
        prompts.length,
        `${id} has more than 2 prompts`,
      ).toBeLessThanOrEqual(2)
      for (const p of prompts) {
        expect(
          p.trim().length,
          `${id} has an empty/whitespace prompt`,
        ).toBeGreaterThan(0)
        expect(p, `${id} prompt should not be pre-quoted`).not.toMatch(/^".*"$/)
      }
    }
  })

  it("has no duplicate prompts within a single connector", () => {
    for (const [id, prompts] of Object.entries(STARTER_PROMPTS)) {
      expect(new Set(prompts).size, `${id} has duplicate prompts`).toBe(
        prompts.length,
      )
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/starter-prompts.test.ts` Expected: FAIL
— `Cannot find module './starter-prompts.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/shared/src/starter-prompts.ts
// Per-connector example prompts shown once a connector is connected — on its
// dashboard card (packages/ui-connectors) and in the proactive Telegram nudge
// (apps/backend/src/services/connector-nudge.ts). Phrased as outcomes the user
// can paste verbatim into Telegram, never as feature descriptions — an example
// that only makes sense in the abstract reads as marketing, not something the
// user can run right now. Keyed by connector id, matching
// packages/ui-connectors/src/catalog.ts's CATALOG_DEFS ids. Covers every
// connector with available: true there (google-photos and swiggy are
// available: false and excluded).
export const STARTER_PROMPTS: Record<string, string[]> = {
  google: [
    "Tell me when I get an email from my boss",
    "Draft a reply to the last email from Sam",
  ],
  "google-calendar": [
    "Let me know if I have back-to-back meetings tomorrow",
    "Find a 30-minute slot this week for a call with Sam",
  ],
  "google-drive": [
    "Find the latest version of the Q3 budget spreadsheet",
    "Tell me when someone shares a new file with me",
  ],
  "google-docs": [
    "Turn my meeting notes into a formatted Google Doc",
    "Summarize the doc I'm working on into three bullet points",
  ],
  "google-maps": [
    "Find coffee shops within 10 minutes of my next meeting",
    "What's the best-rated Italian place near downtown?",
  ],
  "google-sheets": [
    "Add this week's expenses to my budget spreadsheet",
    "Summarize the totals in row 20 of my tracker sheet",
  ],
  "google-slides": [
    "Turn my notes into a 5-slide deck",
    "Add a slide summarizing last quarter's results",
  ],
  "google-classroom": [
    "Tell me what assignments are due this week",
    "Summarize the latest announcement in my Biology class",
  ],
  "google-tasks": [
    "Add 'renew passport' to my to-do list",
    "Tell me what's still open on my task list today",
  ],
  "google-meet": [
    "Set up a meeting link for tomorrow's standup",
    "Summarize the transcript from yesterday's call",
  ],
  notion: [
    "Tell me when the roadmap page changes",
    "Summarize this week's meeting notes",
  ],
  github: [
    "Tell me when a PR is opened against main",
    "Summarize open issues labeled bug",
  ],
  slack: [
    "Summarize unread messages in #general",
    "Notify me when someone mentions me",
  ],
  linear: [
    "Tell me when a P0 issue is created",
    "Summarize what's in progress on my team",
  ],
  hubspot: [
    "Tell me when a new deal moves to negotiation",
    "Summarize this week's new contacts",
  ],
  discord: [
    "Tell me who joined my server this week",
    "Summarize the last 20 messages in #announcements",
  ],
  firecrawl: [
    "Scrape the pricing page of my competitor's site",
    "Extract every article title from this blog's homepage",
  ],
  linkedin: [
    "Draft a post announcing our new feature",
    "Summarize the comments on my latest post",
  ],
  outlook: [
    "Tell me when I get an email from my manager",
    "Summarize my meetings for tomorrow",
  ],
  whatsapp: [
    "Notify me when a customer replies on WhatsApp",
    "Send today's order confirmation template to a customer",
  ],
  jira: [
    "Tell me when a critical bug is filed",
    "Summarize what's in this sprint",
  ],
  reddit: [
    "Find the top posts in r/technology today",
    "Notify me when someone replies to my post",
  ],
  todoist: [
    "Add 'call the dentist' to my personal list",
    "Tell me what's overdue on my task list",
  ],
  figma: [
    "List the components in my design system file",
    "Summarize the latest comments on my mockup",
  ],
  zoom: [
    "Schedule a Zoom call for Thursday at 3pm",
    "Summarize the recording from yesterday's meeting",
  ],
  salesforce: [
    "Tell me when an opportunity moves to Closed Won",
    "Summarize this week's new leads",
  ],
  instagram: [
    "Draft a caption for my next product post",
    "Summarize comments on my latest post",
  ],
  facebook: [
    "Schedule a post for my Page tomorrow morning",
    "Summarize messages waiting in my Page inbox",
  ],
  calendly: [
    "Tell me about my bookings for tomorrow",
    "Check my availability for a call this week",
  ],
  trello: [
    "Add a card to my Sprint board",
    "Summarize what's in the 'In Progress' list",
  ],
  "one-drive": [
    "Find the latest version of the proposal doc",
    "Tell me when a file is shared with me",
  ],
  posthog: [
    "Summarize this week's signup funnel",
    "Tell me if there's a spike in errors today",
  ],
  attio: [
    "Tell me when a deal moves stage",
    "Summarize notes on my last call with a lead",
  ],
  dropbox: [
    "Find the latest file in my shared folder",
    "Tell me when someone uploads to my team folder",
  ],
  "microsoft-teams": [
    "Summarize unread messages in my project channel",
    "Tell me about my meetings today",
  ],
  gumroad: [
    "Tell me about today's sales",
    "Summarize this week's refund requests",
  ],
  miro: [
    "Summarize the sticky notes on my brainstorm board",
    "Add a card to my retro board",
  ],
  mem0: [
    "Remember that I prefer async standups",
    "What do you remember about my project preferences?",
  ],
  zoho: [
    "Tell me when a lead is assigned to me",
    "Summarize this week's new deals",
  ],
  serpapi: [
    "Search for the latest news on AI regulation",
    "Find the top 5 results for 'best CRM 2026'",
  ],
  "dynamics-365": [
    "Tell me when an opportunity is updated",
    "Summarize this week's new accounts",
  ],
  exa: [
    "Find recent research papers on transformer efficiency",
    "Search for companies similar to mine",
  ],
  youtube: [
    "Summarize the top comments on my latest video",
    "Find trending videos in my niche",
  ],
  asana: [
    "Add a task to my Sprint project",
    "Tell me what's overdue on my project",
  ],
  stripe: ["Tell me about today's revenue", "Notify me when a payment fails"],
  supabase: [
    "Tell me how many new rows were added to my users table today",
    "Check if my edge function is deployed",
  ],
  vercel: [
    "Tell me when my latest deployment finishes",
    "Check the status of my production deployment",
  ],
  cloudflare: [
    "Tell me if my zone's DNS records changed",
    "Check my site's current traffic stats",
  ],
  "zoho-invoice": [
    "Tell me when an invoice is overdue",
    "Summarize this week's paid invoices",
  ],
  neon: [
    "Tell me when my database branch is ready",
    "Check my Postgres connection usage this month",
  ],
  fireflies: [
    "Summarize my last recorded meeting",
    "Tell me the action items from yesterday's call",
  ],
  "google-ads": [
    "Summarize this week's campaign performance",
    "Tell me if my cost-per-click spiked today",
  ],
  "google-analytics": [
    "Summarize this week's site traffic",
    "Tell me which page had the most visitors yesterday",
  ],
  "google-search-console": [
    "Tell me if my site's search impressions dropped this week",
    "Summarize my top 5 search queries this month",
  ],
  "google-cloud-vision": [
    "Extract the text from this receipt photo",
    "Tell me what's in this image",
  ],
  kaggle: [
    "Find datasets about customer churn",
    "Summarize the top notebooks for this competition",
  ],
  context7: [
    "Look up the latest docs for the Next.js App Router",
    "Find a code example for Stripe's webhook API",
  ],
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && bun test src/starter-prompts.test.ts` Expected: PASS
(all 3 tests)

- [ ] **Step 5: Wire the export**

```typescript
// packages/shared/src/index.ts — add near the other named re-exports
export { STARTER_PROMPTS } from "./starter-prompts.js"
```

```json
// packages/shared/package.json — add to "exports"
"./starter-prompts": "./src/starter-prompts.ts"
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/shared && bun run typecheck && bun test` Expected: PASS

```bash
git add packages/shared/src/starter-prompts.ts packages/shared/src/starter-prompts.test.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat: add shared connector starter-prompts catalog"
```

---

### Task 2: Wire starter prompts into the ui-connectors catalog

**Files:**

- Modify: `packages/ui-connectors/package.json` (add `@yomi/shared` dependency)
- Modify: `packages/ui-connectors/src/types.ts`
- Modify: `packages/ui-connectors/src/catalog.ts`
- Modify: `packages/ui-connectors/src/catalog.test.ts`

**Interfaces:**

- Consumes: `STARTER_PROMPTS` from `@yomi/shared/starter-prompts` (Task 1).
- Produces: `ConnectorInfo.starterPrompts: string[]`, populated by
  `buildCatalog()` for every entry (defaults to `[]` for an id with no catalog
  match — should never happen once Task 1 covers all `available: true` ids, but
  the fallback keeps `buildCatalog` total).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ui-connectors/src/catalog.test.ts — add this describe block
import { STARTER_PROMPTS } from "@yomi/shared/starter-prompts"

describe("starterPrompts", () => {
  it("every available connector in CATALOG_DEFS has a STARTER_PROMPTS entry", () => {
    const catalog = buildCatalog()
    const missing = catalog.filter(
      (c) => c.available && (STARTER_PROMPTS[c.id] ?? []).length === 0,
    )
    expect(missing.map((c) => c.id)).toEqual([])
  })

  it("carries starter prompts through onto the connector info", () => {
    const catalog = buildCatalog()
    const notion = catalog.find((c) => c.id === "notion")
    expect(notion?.starterPrompts).toEqual(STARTER_PROMPTS["notion"])
  })

  it("defaults to an empty array for an id with no catalog match", () => {
    // available: false connectors are allowed to have no entry
    const catalog = buildCatalog()
    const swiggy = catalog.find((c) => c.id === "swiggy")
    expect(swiggy?.starterPrompts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui-connectors && bun test src/catalog.test.ts` Expected: FAIL
— `starterPrompts` is `undefined`, and the `@yomi/shared/starter-prompts` import
fails to resolve (no dependency yet).

- [ ] **Step 3: Add the workspace dependency**

```json
// packages/ui-connectors/package.json — add a new "dependencies" block
"dependencies": {
  "@yomi/shared": "workspace:*"
}
```

Run: `bun install` (from repo root)

- [ ] **Step 4: Extend `ConnectorInfo`**

```typescript
// packages/ui-connectors/src/types.ts — add to the ConnectorInfo interface
export interface ConnectorInfo {
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "composio" | "api_key" | "connection_string"
  icon: string
  available: boolean
  connected?: boolean
  displayName?: string
  lastSyncAt?: string | null
  /** Example prompts to try once connected, phrased as outcomes. Empty if none authored. */
  starterPrompts: string[]
}
```

- [ ] **Step 5: Populate it in `buildCatalog()`**

```typescript
// packages/ui-connectors/src/catalog.ts — top of file, add the import
import { STARTER_PROMPTS } from "@yomi/shared/starter-prompts"

// inside buildCatalog()'s CATALOG_DEFS.map(...) — add one field
return CATALOG_DEFS.map((def) => ({
  id: def.id,
  name: def.name,
  description: def.description,
  category: def.category,
  authKind: def.authKind,
  icon: def.icon,
  available: def.available,
  connected: connectedSet.has(def.id),
  displayName: displayNames[def.id],
  starterPrompts: STARTER_PROMPTS[def.id] ?? [],
}))
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/ui-connectors && bun test src/catalog.test.ts` Expected: PASS
(all tests, including the coverage check across all 57 `available: true` ids)

- [ ] **Step 7: Typecheck and commit**

Run: `cd packages/ui-connectors && bun run typecheck && bun test` Expected: PASS

```bash
git add packages/ui-connectors/package.json packages/ui-connectors/src/types.ts packages/ui-connectors/src/catalog.ts packages/ui-connectors/src/catalog.test.ts bun.lock
git commit -m "feat: thread starter prompts through the connector catalog"
```

---

### Task 3: Show starter prompts on the connected connector card

**Files:**

- Modify: `packages/ui-connectors/src/components/ConnectorMarketplace.tsx:82-94`

**Interfaces:**

- Consumes: `ConnectorInfo.starterPrompts: string[]` (Task 2).

- [ ] **Step 1: Add the "Try asking Yomi" block**

```tsx
// packages/ui-connectors/src/components/ConnectorMarketplace.tsx
// Replace the existing info.connected block (lines 82-94) with:
{
  info.connected && (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Connected
        </span>
        {account && (
          <span
            className="truncate text-[11px] text-muted-foreground"
            title={account}
          >
            {account}
          </span>
        )}
      </div>
      {info.starterPrompts.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Try asking Yomi
          </p>
          {info.starterPrompts.map((prompt) => (
            <p key={prompt} className="text-xs text-muted-foreground">
              &quot;{prompt}&quot;
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/ui-connectors && bun run typecheck` Expected: PASS

- [ ] **Step 3: Commit**

This task has no dedicated automated test — `packages/ui-connectors` has no
React-rendering test infrastructure set up (confirmed: no
`@testing-library/react` usage anywhere in the package, `catalog.test.ts` only
tests plain functions). It's covered by Task 2's data-layer test
(`starterPrompts` is populated correctly) plus manual verification in Task 10.

```bash
git add packages/ui-connectors/src/components/ConnectorMarketplace.tsx
git commit -m "feat: show starter prompts on connected connector cards"
```

---

### Task 4: Database migration for the pending-nudge column

**Files:**

- Modify: `apps/backend/src/auth-schema.ts:33-36`
- Create: `packages/db/drizzle/0034_pending_connector_nudge.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**

- Produces: `authSchema.user.pendingConnectorNudge` — nullable jsonb column,
  shape `{ connectorIds: string[]; dueAt: string }` when set, consumed by
  Task 6.

- [ ] **Step 1: Add the column to the Drizzle schema**

```typescript
// apps/backend/src/auth-schema.ts — inside the `user` pgTable, after soulOnboarding (line 35)
  soulOnboarding: text("soul_onboarding").notNull().default("unprompted"),
  // Debounced Telegram nudge after a new connector connects. Shape when set:
  // { connectorIds: string[]; dueAt: string (ISO) }. Null when no nudge is
  // pending — cleared once services/connector-nudge.ts sends or skips it.
  pendingConnectorNudge: jsonb("pending_connector_nudge"),
  deletedAt: timestamp("deleted_at"),
```

- [ ] **Step 2: Write the migration SQL**

This repo's Drizzle config (`packages/db/drizzle.config.ts`) only points at
`packages/db/src/schema.ts`, but `apps/backend/src/auth-schema.ts` (the real
Better Auth `user` table extension) is migrated by hand-writing SQL directly
into `packages/db/drizzle/` and registering it in the journal — this is the
exact pattern the previous `soul_onboarding`/`agent_soul` columns used
(`packages/db/drizzle/0020_user_agent_soul.sql`).

```sql
-- packages/db/drizzle/0034_pending_connector_nudge.sql
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pending_connector_nudge" jsonb;
```

- [ ] **Step 3: Register the migration in the journal**

```json
// packages/db/drizzle/meta/_journal.json — append to the "entries" array, after idx 33
{
  "idx": 34,
  "version": "7",
  "when": 1786320000000,
  "tag": "0034_pending_connector_nudge",
  "breakpoints": true
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && bun run typecheck` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth-schema.ts packages/db/drizzle/0034_pending_connector_nudge.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat: add pending_connector_nudge column to user table"
```

- [ ] **Step 6: Run the migration against the dev database (manual, not part of
      the commit)**

Run: `cd packages/db && bun run db:migrate` Expected:
`0034_pending_connector_nudge` applied. This must also be run against production
after this branch merges and deploys — deploys ship code only, per this repo's
existing migration convention.

---

### Task 5: Extract shared Telegram delivery helpers

**Files:**

- Create: `apps/backend/src/services/telegram-delivery.ts`
- Modify: `apps/backend/src/services/schedule-runner.ts:1-36`

**Interfaces:**

- Produces: `telegramChatFor(userId: string): Promise<string | null>`,
  `sendTelegram(chatId: string, text: string): Promise<boolean>` — identical
  behavior to the current private helpers, now exported for reuse by Task 6.

- [ ] **Step 1: Create the extracted module**

```typescript
// apps/backend/src/services/telegram-delivery.ts
import { and, eq } from "drizzle-orm"
import { db, platformConnections } from "@yomi/db"

// Sends a plain text message directly via the Telegram Bot API — not through
// runAgent(). Used for template-filled, uncharged messages (schedule delivery,
// connector starter-prompt nudges), never for agent-generated replies.
export async function sendTelegram(
  chatId: string,
  text: string,
): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"]
  if (!token) return false
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

export async function telegramChatFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      chatId: platformConnections.platformChatId,
      userId: platformConnections.platformUserId,
    })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.userId, userId),
        eq(platformConnections.platform, "telegram"),
      ),
    )
    .limit(1)
  return row?.chatId ?? row?.userId ?? null
}
```

- [ ] **Step 2: Update `schedule-runner.ts` to import instead of define**

```typescript
// apps/backend/src/services/schedule-runner.ts — replace lines 1-36
import { and, asc, eq, isNotNull, lte } from "drizzle-orm"
import { db, schedules } from "@yomi/db"
import { runAgent } from "../agent/run.js"
import { computeNextRun, type ScheduleType } from "./schedule-parser.js"
import { summarizeUnsummarizedSessions } from "./agent-sessions.js"
import { sendTelegram, telegramChatFor } from "./telegram-delivery.js"

const MAX_PER_SWEEP = 25

// Scans for due schedules and runs each: execute the agent, deliver the result, then
// reschedule (or disable one-shots). Called from the Worker cron trigger every minute.
// Each schedule is isolated so one failure doesn't block the rest.
```

Note: `platformConnections` is no longer imported directly in
`schedule-runner.ts` (moved into `telegram-delivery.ts`) — remove it from the
`@yomi/db` import if nothing else in the file uses it. Check the rest of the
file for other `platformConnections` references before removing; if none remain,
the import list becomes just `{ db, schedules }`.

- [ ] **Step 3: Typecheck and run backend tests**

Run: `cd apps/backend && bun run typecheck && bun test` Expected: PASS — no
existing test file exercises `schedule-runner.ts` directly (confirmed: no
`schedule-runner.test.ts` exists in this repo), so this is a behavior-preserving
extraction verified by typecheck plus the full suite staying green.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/services/telegram-delivery.ts apps/backend/src/services/schedule-runner.ts
git commit -m "refactor: extract telegram delivery helpers for reuse"
```

---

### Task 6: Connector-nudge service — pure logic (TDD) + DB-touching functions

**Files:**

- Create: `apps/backend/src/services/connector-nudge.ts`
- Create: `apps/backend/src/services/connector-nudge.test.ts`

**Interfaces:**

- Consumes: `STARTER_PROMPTS` (`@yomi/shared/starter-prompts`, Task 1),
  `getConnectorDef` (`../connectors/registry.js`, existing),
  `sendTelegram`/`telegramChatFor` (`./telegram-delivery.js`, Task 5),
  `authSchema.user.pendingConnectorNudge` (Task 4).
- Produces:
  - `computeNextNudgeState(existing: PendingNudge | null, connectorId: string, now: Date): PendingNudge`
    — pure.
  - `buildNudgeMessage(connectorIds: string[]): string | null` — pure.
  - `markConnectorConnected(userId: string, connectorId: string): Promise<void>`
    — DB write, used by Tasks 7-8.
  - `runDueConnectorNudges(now?: Date): Promise<{ ran: number }>` — DB sweep,
    used by Task 9.
  - `type PendingNudge = { connectorIds: string[]; dueAt: string }`

- [ ] **Step 1: Write the failing tests for the pure functions**

```typescript
// apps/backend/src/services/connector-nudge.test.ts
import { describe, expect, it } from "bun:test"
import { buildNudgeMessage, computeNextNudgeState } from "./connector-nudge.js"

describe("computeNextNudgeState", () => {
  const now = new Date("2026-08-09T12:00:00.000Z")

  it("creates a new pending state 5 minutes out when none exists", () => {
    const next = computeNextNudgeState(null, "notion", now)
    expect(next.connectorIds).toEqual(["notion"])
    expect(next.dueAt).toBe(new Date("2026-08-09T12:05:00.000Z").toISOString())
  })

  it("appends to an existing batch without moving dueAt", () => {
    const existing = {
      connectorIds: ["notion"],
      dueAt: new Date("2026-08-09T12:03:00.000Z").toISOString(),
    }
    const next = computeNextNudgeState(existing, "slack", now)
    expect(next.connectorIds).toEqual(["notion", "slack"])
    expect(next.dueAt).toBe(existing.dueAt)
  })

  it("dedupes if the same connector connects twice in one window", () => {
    const existing = {
      connectorIds: ["notion"],
      dueAt: new Date("2026-08-09T12:03:00.000Z").toISOString(),
    }
    const next = computeNextNudgeState(existing, "notion", now)
    expect(next.connectorIds).toEqual(["notion"])
  })
})

describe("buildNudgeMessage", () => {
  it("returns null for an empty batch", () => {
    expect(buildNudgeMessage([])).toBeNull()
  })

  it("returns null for a connector with no authored prompts", () => {
    expect(buildNudgeMessage(["not-a-real-connector-id"])).toBeNull()
  })

  it("shows up to 2 prompts for a single connector", () => {
    const msg = buildNudgeMessage(["notion"])
    expect(msg).toContain("Notion")
    expect(msg).toContain("Tell me when the roadmap page changes")
    expect(msg).toContain("Summarize this week's meeting notes")
  })

  it("shows 1 prompt per connector, capped at 3, for a multi-connector batch", () => {
    const msg = buildNudgeMessage(["notion", "slack", "github", "linear"])
    expect(msg).toContain("Tell me when the roadmap page changes") // notion's first prompt
    expect(msg).toContain("Summarize unread messages in #general") // slack's first prompt
    expect(msg).toContain("Tell me when a PR is opened against main") // github's first prompt
    expect(msg).not.toContain("Tell me when a P0 issue is created") // linear's — 4th connector, cut by the cap
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && bun test src/services/connector-nudge.test.ts`
Expected: FAIL — `Cannot find module './connector-nudge.js'`

- [ ] **Step 3: Implement**

```typescript
// apps/backend/src/services/connector-nudge.ts
import { eq, isNotNull } from "drizzle-orm"
import { db } from "@yomi/db"
import { STARTER_PROMPTS } from "@yomi/shared/starter-prompts"
import * as authSchema from "../auth-schema.js"
import { getConnectorDef } from "../connectors/registry.js"
import { sendTelegram, telegramChatFor } from "./telegram-delivery.js"

const NUDGE_DEBOUNCE_MS = 5 * 60 * 1000
const MAX_NUDGE_PROMPTS = 3

export interface PendingNudge {
  connectorIds: string[]
  dueAt: string
}

// Fixed-window debounce: the first connect in a burst sets dueAt 5 minutes out;
// later connects in the same window extend the connector list but never push
// dueAt further, so a nudge is always guaranteed to fire.
export function computeNextNudgeState(
  existing: PendingNudge | null,
  connectorId: string,
  now: Date,
): PendingNudge {
  if (!existing) {
    return {
      connectorIds: [connectorId],
      dueAt: new Date(now.getTime() + NUDGE_DEBOUNCE_MS).toISOString(),
    }
  }
  const connectorIds = existing.connectorIds.includes(connectorId)
    ? existing.connectorIds
    : [...existing.connectorIds, connectorId]
  return { connectorIds, dueAt: existing.dueAt }
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

// Builds the Telegram nudge text from a batch of newly-connected connector ids.
// Single connector: up to 2 of its prompts. Multiple: 1 prompt each, capped at
// MAX_NUDGE_PROMPTS total (earliest-connected connectors win ties).
export function buildNudgeMessage(connectorIds: string[]): string | null {
  if (connectorIds.length === 0) return null

  const prompts: string[] = []
  if (connectorIds.length === 1) {
    const [id] = connectorIds
    prompts.push(...(STARTER_PROMPTS[id ?? ""] ?? []).slice(0, 2))
  } else {
    for (const id of connectorIds) {
      const [first] = STARTER_PROMPTS[id] ?? []
      if (first) prompts.push(first)
      if (prompts.length >= MAX_NUDGE_PROMPTS) break
    }
  }
  if (prompts.length === 0) return null

  const names = connectorIds
    .filter((id) => (STARTER_PROMPTS[id] ?? []).length > 0)
    .map((id) => getConnectorDef(id)?.name ?? id)
  const suffix = names.length === 1 ? "'s" : " are"
  const header = `🔌 ${joinNames(names)}${suffix} connected. Try:`
  const body =
    prompts.length === 1
      ? `"${prompts[0]}"`
      : prompts.map((p) => `• ${p}`).join("\n")
  return `${header}\n${body}`
}

function parsePendingNudge(value: unknown): PendingNudge | null {
  if (!value || typeof value !== "object") return null
  const v = value as Partial<PendingNudge>
  if (!Array.isArray(v.connectorIds) || typeof v.dueAt !== "string") return null
  return { connectorIds: v.connectorIds, dueAt: v.dueAt }
}

// Called after a genuinely new connector connection (never a reconnect) —
// see Tasks 7-8 for the "was this new" check at each call site.
export async function markConnectorConnected(
  userId: string,
  connectorId: string,
): Promise<void> {
  const [row] = await db
    .select({ pendingConnectorNudge: authSchema.user.pendingConnectorNudge })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  const existing = parsePendingNudge(row?.pendingConnectorNudge)
  const next = computeNextNudgeState(existing, connectorId, new Date())
  await db
    .update(authSchema.user)
    .set({ pendingConnectorNudge: next })
    .where(eq(authSchema.user.id, userId))
}

// Scans for due connector nudges and sends each via Telegram — a template
// fill, not an agent run. Called from the same 60s cron tick as
// runDueSchedules (worker.ts, index.ts). Each user is isolated so one
// failure doesn't block the rest.
export async function runDueConnectorNudges(
  now: Date = new Date(),
): Promise<{ ran: number }> {
  const rows = await db
    .select({
      id: authSchema.user.id,
      pendingConnectorNudge: authSchema.user.pendingConnectorNudge,
    })
    .from(authSchema.user)
    .where(isNotNull(authSchema.user.pendingConnectorNudge))

  let ran = 0
  for (const row of rows) {
    const nudge = parsePendingNudge(row.pendingConnectorNudge)
    if (!nudge || new Date(nudge.dueAt) > now) continue

    try {
      const chatId = await telegramChatFor(row.id)
      if (chatId) {
        const text = buildNudgeMessage(nudge.connectorIds)
        if (text) await sendTelegram(chatId, text)
      }
    } finally {
      await db
        .update(authSchema.user)
        .set({ pendingConnectorNudge: null })
        .where(eq(authSchema.user.id, row.id))
      ran++
    }
  }
  return { ran }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/services/connector-nudge.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && bun run typecheck` Expected: PASS

Note: `markConnectorConnected` and `runDueConnectorNudges` are sweep/batch-style
DB functions (not "which branch did we take" logic), so per the Global
Constraints testing note they follow `schedule-runner.ts`'s `runDueSchedules`
precedent and are exercised via Task 10's manual end-to-end check rather than a
mocked-DB unit test.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/connector-nudge.ts apps/backend/src/services/connector-nudge.test.ts
git commit -m "feat: add connector starter-prompt nudge service"
```

---

### Task 7: Trigger the nudge on new Composio connector connections

**Files:**

- Modify: `apps/backend/src/services/composio-connect.ts:115-129`
- Modify: `apps/backend/src/services/composio-connect.test.ts`
- Modify: `apps/backend/src/routes/integrations.ts:594-636`

**Interfaces:**

- Consumes: `markConnectorConnected` (`./connector-nudge.js`, Task 6),
  `isRowConnected` (existing, `composio-connect.ts:137`).
- Produces: `markComposioConnectionActive` now returns
  `Promise<{ wasNewConnection: boolean }>` instead of `Promise<void>` — a
  breaking change to its one caller, updated in the same task.

- [ ] **Step 1: Write the failing test for the new-vs-reconnect distinction**

The spec requires this distinction be verified, not just implemented —
`composio-connect.test.ts` currently only tests pure functions
(`encodeComposioRef`/`decodeComposioRef`/`isRowConnected`), but this repo does
have precedent for mocking `@yomi/db` at the service/route level
(`apps/backend/src/routes/admin-explore-reset.test.ts`), so that's the pattern
to follow here rather than skipping coverage.

```typescript
// apps/backend/src/services/composio-connect.test.ts — add above the existing describes
import { beforeEach, mock } from "bun:test"
import { encryptString } from "./token-encryption.js"

const dbState = { existingOauthTokens: null as string | null, upserts: 0 }

mock.module("@yomi/db", () => ({
  mcpConnections: { userId: "user_id", provider: "provider" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            dbState.existingOauthTokens
              ? [{ oauthTokens: dbState.existingOauthTokens }]
              : [],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {
          dbState.upserts++
        },
      }),
    }),
  },
}))

const { markComposioConnectionActive } = await import("./composio-connect.js")

beforeEach(() => {
  process.env.ENCRYPTION_KEY =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  dbState.existingOauthTokens = null
  dbState.upserts = 0
})

describe("markComposioConnectionActive — wasNewConnection", () => {
  const def = {
    id: "notion",
    auth: { kind: "composio", toolkit: "notion" },
  } as any

  it("is true when no row exists yet (first-ever connect)", async () => {
    const { wasNewConnection } = await markComposioConnectionActive(
      "user_1",
      def,
      "ca_1",
    )
    expect(wasNewConnection).toBe(true)
    expect(dbState.upserts).toBe(1)
  })

  it("is true when the existing row was only 'initiated', never active", async () => {
    dbState.existingOauthTokens = encryptString(
      JSON.stringify({
        kind: "composio",
        toolkit: "notion",
        connectedAccountId: null,
        status: "initiated",
      }),
    )
    const { wasNewConnection } = await markComposioConnectionActive(
      "user_1",
      def,
      "ca_1",
    )
    expect(wasNewConnection).toBe(true)
  })

  it("is false when the existing row was already active (reconnect/re-auth)", async () => {
    dbState.existingOauthTokens = encryptString(
      JSON.stringify({
        kind: "composio",
        toolkit: "notion",
        connectedAccountId: "ca_0",
        status: "active",
      }),
    )
    const { wasNewConnection } = await markComposioConnectionActive(
      "user_1",
      def,
      "ca_1",
    )
    expect(wasNewConnection).toBe(false)
  })
})
```

Note: `encryptString` (not `encryptTokens`) matches how `encodeComposioRef`
encodes refs (`composio-connect.ts:21-23`) — confirm this import exists in
`token-encryption.ts` before using it (it's already imported by
`composio-connect.ts` itself, so it exists).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test src/services/composio-connect.test.ts`
Expected: FAIL — `markComposioConnectionActive` still returns `void`, so
`wasNewConnection` is `undefined`.

- [ ] **Step 3: Change `markComposioConnectionActive` to report whether this was
      a new connection**

```typescript
// apps/backend/src/services/composio-connect.ts — replace lines 115-129
// Mark a previously-initiated Composio connection active (called after Composio
// redirects the user back). Idempotent upsert of the reference. Reports
// wasNewConnection = true only when the row didn't previously exist or was
// never active (status "initiated"/"failed") — a row already active means this
// is a reconnect/re-auth, not a first-time connect.
export async function markComposioConnectionActive(
  userId: string,
  def: ConnectorDef,
  connectedAccountId: string | null,
): Promise<{ wasNewConnection: boolean }> {
  if (def.auth.kind !== "composio") throw new Error("not a composio connector")

  const [existingRow] = await db
    .select({ oauthTokens: mcpConnections.oauthTokens })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.userId, userId),
        eq(mcpConnections.provider, def.id),
      ),
    )
    .limit(1)
  const wasNewConnection =
    !existingRow || !isRowConnected(existingRow.oauthTokens)

  await upsertComposioConnection(userId, def.id, {
    kind: "composio",
    toolkit: def.auth.toolkit,
    connectedAccountId,
    status: "active",
  })

  return { wasNewConnection }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test src/services/composio-connect.test.ts`
Expected: PASS (all tests, including the 3 new `wasNewConnection` cases)

- [ ] **Step 5: Call `markConnectorConnected` from the Composio callback route
      on a new connection**

```typescript
// apps/backend/src/routes/integrations.ts — replace lines 623-628
  try {
    const { markComposioConnectionActive } = await import("../services/composio-connect.js")
    const { wasNewConnection } = await markComposioConnectionActive(userId, def, connectedAccountId)
    await grantConsentIfUndecided(userId, ["connector_data"], "connector_composio").catch((err) =>
      console.warn("[yomi/integrations] connector consent grant failed:", err),
    )
    if (wasNewConnection) {
      const { markConnectorConnected } = await import("../services/connector-nudge.js")
      markConnectorConnected(userId, id).catch((err) =>
        console.warn("[yomi/integrations] connector nudge scheduling failed:", err),
      )
    }
  } catch (err) {
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && bun run typecheck` Expected: PASS

- [ ] **Step 7: Run the full backend test suite**

Run: `cd apps/backend && bun test` Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/services/composio-connect.ts apps/backend/src/services/composio-connect.test.ts apps/backend/src/routes/integrations.ts
git commit -m "feat: schedule starter-prompt nudge on new composio connections"
```

---

### Task 8: Trigger the nudge on new API-key connector connections

**Files:**

- Modify: `apps/backend/src/connectors/executors/oauth2-executor.ts:241-276`
- Create: `apps/backend/src/connectors/executors/oauth2-executor.test.ts`
- Modify: `apps/backend/src/routes/integrations.ts:672`

**Interfaces:**

- Consumes: `markConnectorConnected` (`../services/connector-nudge.js`, Task 6).
- Produces: `storeApiKeyCredential` now returns
  `Promise<{ wasNewConnection: boolean }>` instead of `Promise<void>`.

This is the second (and, per the catalog, only other live) connect path for an
`available: true` connector — it currently covers `context7`.
`handleOAuth2Callback` (non-Composio `oauth2` kind) and `storeConnectionString`
(`connection_string` kind) are not wired: the only catalog entry using `oauth2`
(`swiggy`) is `available: false`, and no current catalog entry uses
`connection_string` — wiring those paths now would be dead code for connectors
nobody can connect yet. If a future `oauth2` or `connection_string` connector
ships as `available: true`, wire `markConnectorConnected` there the same way
this task does for `storeApiKeyCredential`.

- [ ] **Step 1: Write the failing test for the new-vs-reconnect distinction**

No test file exists yet for this module — creating one, following the same
`mock.module("@yomi/db")` pattern used in Task 7.

```typescript
// apps/backend/src/connectors/executors/oauth2-executor.test.ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

const dbState = { existingRow: null as { id: string } | null, upserts: 0 }

mock.module("@yomi/db", () => ({
  mcpConnections: { userId: "user_id", provider: "provider", id: "id" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (dbState.existingRow ? [dbState.existingRow] : []),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {
          dbState.upserts++
        },
      }),
    }),
  },
}))

const { storeApiKeyCredential } = await import("./oauth2-executor.js")

beforeEach(() => {
  process.env.ENCRYPTION_KEY =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  dbState.existingRow = null
  dbState.upserts = 0
})

describe("storeApiKeyCredential — wasNewConnection", () => {
  const def = {
    id: "context7",
    name: "Context7",
    auth: { kind: "api_key", fields: [{ name: "api_key" }] },
  } as any

  it("is true when no row exists yet", async () => {
    const { wasNewConnection } = await storeApiKeyCredential(def, "user_1", {
      api_key: "k",
    })
    expect(wasNewConnection).toBe(true)
    expect(dbState.upserts).toBe(1)
  })

  it("is false when a row already exists (key rotation, not a first connect)", async () => {
    dbState.existingRow = { id: "row_1" }
    const { wasNewConnection } = await storeApiKeyCredential(def, "user_1", {
      api_key: "new-key",
    })
    expect(wasNewConnection).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`cd apps/backend && bun test src/connectors/executors/oauth2-executor.test.ts`
Expected: FAIL — `storeApiKeyCredential` still returns `void`, so
`wasNewConnection` is `undefined`.

- [ ] **Step 3: Change `storeApiKeyCredential` to report whether this was a new
      connection**

```typescript
// apps/backend/src/connectors/executors/oauth2-executor.ts — replace lines 241-276
export async function storeApiKeyCredential(
  def: BackendConnectorDef,
  userId: string,
  fields: Record<string, string>,
): Promise<{ wasNewConnection: boolean }> {
  if (def.auth.kind !== "api_key")
    throw new Error(`${def.id} is not an api_key connector`)

  const [existingRow] = await db
    .select({ id: mcpConnections.id })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.userId, userId),
        eq(mcpConnections.provider, def.id),
      ),
    )
    .limit(1)
  const wasNewConnection = !existingRow

  // The primary field value is stored as accessToken for compatibility with getAccessToken()
  const primaryField = def.auth.fields[0]?.name ?? "api_key"
  const tokens: OAuthTokens = {
    accessToken: fields[primaryField] ?? "",
    refreshToken: null,
    expiresAt: null,
    scope: def.auth.fields.map((f) => f.name).join(","),
  }
  const encrypted = encryptTokens(tokens)

  await db
    .insert(mcpConnections)
    .values({
      userId,
      provider: def.id,
      oauthTokens: encrypted,
      scopes: [],
      displayName: def.name,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [mcpConnections.userId, mcpConnections.provider],
      set: {
        oauthTokens: encrypted,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    })

  return { wasNewConnection }
}
```

Check the top of `oauth2-executor.ts` for its existing `and`/`eq` import from
`drizzle-orm` — `handleOAuth2Callback` already uses `and`/`eq` for a similar
upsert, so this likely just reuses an existing import rather than adding a new
one.

- [ ] **Step 4: Run test to verify it passes**

Run:
`cd apps/backend && bun test src/connectors/executors/oauth2-executor.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Call `markConnectorConnected` from the API-key connect route on
      a new connection**

```typescript
// apps/backend/src/routes/integrations.ts — replace line 672
const { wasNewConnection } = await storeApiKeyCredential(def, userId, fields)
await grantConsentIfUndecided(
  userId,
  ["connector_data"],
  "connector_api_key",
).catch((err) =>
  console.warn("[yomi/integrations] connector consent grant failed:", err),
)
if (wasNewConnection) {
  const { markConnectorConnected } =
    await import("../services/connector-nudge.js")
  markConnectorConnected(userId, id).catch((err) =>
    console.warn("[yomi/integrations] connector nudge scheduling failed:", err),
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && bun run typecheck` Expected: PASS

- [ ] **Step 7: Run the full backend test suite**

Run: `cd apps/backend && bun test` Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/connectors/executors/oauth2-executor.ts apps/backend/src/connectors/executors/oauth2-executor.test.ts apps/backend/src/routes/integrations.ts
git commit -m "feat: schedule starter-prompt nudge on new api-key connections"
```

---

### Task 9: Wire the nudge sweep into the existing cron ticks

**Files:**

- Modify: `apps/backend/src/worker.ts` (around line 61, alongside
  `runDueSchedules`)
- Modify: `apps/backend/src/index.ts:152-164` (`runCronSweeps`)

**Interfaces:**

- Consumes: `runDueConnectorNudges` (`./services/connector-nudge.js`, Task 6).

- [ ] **Step 1: Wire into `worker.ts` (Workers cron path)**

```typescript
// apps/backend/src/worker.ts — near the top import
import { runDueConnectorNudges } from "./services/connector-nudge.js"

// wherever runDueSchedules() is invoked (around line 61), add alongside it:
runDueConnectorNudges()
```

Read the surrounding 10 lines of `worker.ts` around the existing
`runDueSchedules()` call before editing, to match whatever
error-handling/logging wrapper it already uses (e.g. `.catch()`,
`ctx.waitUntil()`) exactly — this task must not change how `runDueSchedules`
itself is invoked, only add a sibling call in the same style.

- [ ] **Step 2: Wire into `index.ts` (`runCronSweeps`, EC2/Bun path)**

```typescript
// apps/backend/src/index.ts — inside runCronSweeps() (lines 152-164)
async function runCronSweeps(): Promise<void> {
  const { runDueSchedules } = await import("./services/schedule-runner.js")
  const { runDueConnectorNudges } = await import("./services/connector-nudge.js")
  const { runPrivacyRetention } = await import("./services/privacy/retention.js")
  const { runDriveSyncSweep } = await import("./services/rag/drive-sync.js")
  const { summarizeUnsummarizedSessions } = await import("./services/agent-sessions.js")
  const { renewExploreCredits } = await import("./services/explore-renewal.js")
  const { sweepMemoryConsolidation } = await import("./services/memory/consolidation.js")
  await Promise.all([
    runDueSchedules()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[schedules] ran ${ran} due schedule(s)`)
      })
      .catch((err) => console.error("[schedules] sweep error:", err)),
    runDueConnectorNudges()
      .then(({ ran }) => {
        if (ran > 0) console.warn(`[connector-nudge] ran ${ran} due nudge(s)`)
      })
      .catch((err) => console.error("[connector-nudge] sweep error:", err)),
    runPrivacyRetention()
      .then((r) => {
```

Keep every other line of `runCronSweeps()` (the `runPrivacyRetention` block
onward) unchanged — this only adds one new import and one new entry to the
existing `Promise.all` array.

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && bun run typecheck` Expected: PASS

- [ ] **Step 4: Run the full backend test suite**

Run: `cd apps/backend && bun test` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/worker.ts apps/backend/src/index.ts
git commit -m "feat: wire connector-nudge sweep into cron ticks"
```

---

### Task 10: End-to-end manual verification

No code changes — this task confirms the full path works together, since Tasks
6-9's DB-touching code has no automated coverage per this codebase's convention
(Global Constraints).

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run (from repo root): `bun run test && bun run typecheck` Expected: PASS across
all packages touched (`packages/shared`, `packages/ui-connectors`,
`apps/backend`).

- [ ] **Step 2: Run lint**

Run (from repo root): `bun run lint` Expected: PASS (CI runs lint; the pre-push
checklist in `AGENTS.md` is otherwise easy to satisfy without it).

- [ ] **Step 3: Apply the migration to the local/dev database**

Run: `cd packages/db && bun run db:migrate` Expected:
`0034_pending_connector_nudge` shows as applied;
`SELECT pending_connector_nudge FROM "user" LIMIT 1;` succeeds (column exists,
value is `NULL` for existing rows).

- [ ] **Step 4: Verify the dashboard card manually**

Run `bun run dev`, open the dashboard's Integrations tab, and connect a
connector that has no account yet (e.g. Notion or a Composio-backed connector in
a test/dev environment). Confirm:

- The card flips to "Connected".
- A "Try asking Yomi" block appears below the Connected badge with 2 example
  prompts, matching `STARTER_PROMPTS["notion"]`.
- Disconnect and reconnect the same connector — confirm the card still shows the
  block (this doesn't test the nudge-suppression logic, which is Telegram-side;
  the dashboard always shows prompts for any connected connector).

- [ ] **Step 5: Verify the Telegram nudge manually (requires a linked Telegram
      account in the dev environment)**

With a test user whose Telegram is linked (`platformConnections`,
`platform = "telegram"`) and who does **not** already have this connector
connected:

1. Connect a connector via the dashboard.
2. Confirm a row exists:
   `SELECT pending_connector_nudge FROM "user" WHERE id = '<test-user-id>';`
   shows `{"connectorIds": ["<id>"], "dueAt": "<~5 min from now>"}`.
3. Either wait ~5 minutes for the real cron tick, or manually invoke
   `runDueConnectorNudges(new Date(Date.now() + 6 * 60 * 1000))` from a scratch
   script/REPL to force it due.
4. Confirm the Telegram message arrives with the expected prompt(s), and
   `pending_connector_nudge` is cleared back to `NULL` afterward.
5. Connect a second connector for the same user within the 5-minute window
   (before step 3's forced-due call) — confirm `connectorIds` grows to include
   both and `dueAt` does not move.

- [ ] **Step 6: Confirm no nudge on reconnect**

Disconnect and reconnect a connector the test user already has active. Confirm
`pending_connector_nudge` stays `NULL` (or, if already pending from an unrelated
new connect, is not modified by this reconnect).

- [ ] **Step 7: Final commit (if Step 4 surfaced any responsive/visual fix)**

Only if manual verification surfaced a real defect (not a hypothetical one) —
fix it, re-verify, and commit separately with a `fix:` message describing what
broke.
