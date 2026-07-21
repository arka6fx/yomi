# Settings Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gear-icon settings menu to the dashboard, absorbing the sprawling "account" tab and the "privacy" tab, and ship writing style end-to-end (an existing-but-unwired `agentSoul` field).

**Architecture:** A new `SettingsMenu` component (`apps/landing/src/components/dashboard/`) drives navigation via the dashboard's existing `activeTab` state — no new state paradigm. The "account" tab's existing JSX splits, unmoved in content, into "profile" and "billing" blocks. `apps/backend/src/routes/profile.ts`'s existing route gains one optional field.

**Tech Stack:** Next.js client components (Tailwind), Hono, Bun test.

## Global Constraints

- Full design rationale lives in
  `docs/superpowers/specs/2026-07-22-settings-menu-design.md` — read it if
  anything here seems underspecified.
- `SettingsMenu` uses Tailwind (matching `dashboard/page.tsx` and its
  sibling components `MemoryManager`/`PrivacyManager`/etc.), **not**
  `ui-connectors`' inline-style theme-token system — this is dashboard-page
  UI, not a portable connector widget.
- The "account" tab's relocated content (welcome banner, Telegram card,
  billing warnings, plan card, usage stats, plans grid) must move
  **verbatim** — no rewriting, no visual changes to that content itself,
  only which conditional wraps it.
- Deliberately not built: profile name editing (backend route already
  supports it, but wiring a rename UI is out of scope this round — Profile
  is read-only), and everything listed as out-of-scope in the spec (maps
  provider, language, quiet check-ins, meeting recaps, call settings,
  referrals, FAQ) — none of these have a backend hook today.
- No React component test harness in `apps/landing` — UI tasks are
  verified with typecheck + lint only, consistent with every prior UI
  feature this session.

---

### Task 1: Backend — writing style support

**Files:**
- Modify: `apps/backend/src/auth.ts`
- Modify: `apps/backend/src/routes/profile.ts`
- Modify: `apps/backend/src/routes/profile.test.ts`

**Interfaces:**
- Consumes: `authSchema.user.agentSoul` (existing column, confirmed present
  in `apps/backend/src/auth-schema.ts:33`).
- Produces: `GET /api/user/me` response gains `agentSoul: string | null`.
  `PATCH /api/user/profile` accepts `{ name?: string; agentSoul?: string }`
  — either field independently, at least one required — consumed by
  Task 4 (the frontend writing-style tab).

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/routes/profile.test.ts`, find the `updateName` helper:

```ts
function updateName(name: string) {
  return app().request("/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}
```

Add a general-purpose helper immediately after it:

```ts
function updateProfile(body: Record<string, unknown>) {
  return app().request("/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
```

Find the `TestUser` type and add `agentSoul` for the GET /me test:

```ts
type TestUser = {
  id: string
}
```

Change to:

```ts
type TestUser = {
  id: string
  agentSoul?: string | null
}
```

At the end of the `describe("PATCH /api/user/profile", ...)` block (after
the existing `"rejects empty display names"` test, before its closing
`})`), add:

```ts
  it("updates agentSoul alone, without requiring name", async () => {
    updateRows = [{ name: "Arka", email: "arka@example.com", agentSoul: "be terse" }]

    const res = await updateProfile({ agentSoul: "be terse" })
    const body = (await res.json()) as { agentSoul?: string }

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ agentSoul: "be terse" })
    expect(body.agentSoul).toBe("be terse")
  })

  it("updates name and agentSoul together", async () => {
    updateRows = [{ name: "Arka", email: "arka@example.com", agentSoul: "be terse" }]

    await updateProfile({ name: "Arka", agentSoul: "be terse" })

    expect(updatePayload).toEqual({ name: "Arka", agentSoul: "be terse" })
  })

  it("rejects a request with neither name nor agentSoul", async () => {
    const res = await updateProfile({})
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_body")
    expect(updateCalls).toBe(0)
  })

  it("rejects an agentSoul longer than 2000 characters", async () => {
    const res = await updateProfile({ agentSoul: "a".repeat(2001) })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_agent_soul")
    expect(updateCalls).toBe(0)
  })
```

Add a new `describe` block after the existing one, at the end of the file:

```ts
describe("GET /api/user/me", () => {
  beforeEach(() => {
    currentUser = { id: "user_1", agentSoul: "be terse" }
  })

  it("includes agentSoul in the response", async () => {
    const res = await app().request("/api/user/me", {
      headers: { Authorization: "Bearer test" },
    })
    const body = (await res.json()) as { agentSoul?: string | null }

    expect(res.status).toBe(200)
    expect(body.agentSoul).toBe("be terse")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && bun test src/routes/profile.test.ts`
Expected: FAIL — `agentSoul` isn't accepted by the PATCH handler yet
(the "updates agentSoul alone" test gets a 400 "Name is required" instead
of 200), and `GET /me`'s response doesn't include `agentSoul` yet.

- [ ] **Step 3: Extend the `SessionUser` type**

In `apps/backend/src/auth.ts`, find:

```ts
export type SessionUser = AuthInstance["$Infer"]["Session"]["user"] & {
  role: string
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
  currentPeriodEnd: Date | null
  dodoCustomerId: string | null
  dodoSubscriptionId: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatCount: number
  dailyVoiceCount: number
  dailyImageCount: number
  agentUsageCount: number
  dailyResetDate: string | null
  deletedAt: Date | null
}
```

Change to:

```ts
export type SessionUser = AuthInstance["$Infer"]["Session"]["user"] & {
  role: string
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
  currentPeriodEnd: Date | null
  dodoCustomerId: string | null
  dodoSubscriptionId: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatCount: number
  dailyVoiceCount: number
  dailyImageCount: number
  agentUsageCount: number
  dailyResetDate: string | null
  deletedAt: Date | null
  agentSoul: string | null
}
```

- [ ] **Step 4: Extend the route**

In `apps/backend/src/routes/profile.ts`, replace the entire file with:

```ts
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "@yomi/db"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"

export const profileRouter = new Hono()

type ProfileBody = {
  name?: string
  agentSoul?: string
}

// Lightweight session check — returns 200 with basic user info if token is valid, 401 otherwise
profileRouter.get("/me", authenticate, (c) => {
  const user = c.get("user")
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    role: user.role,
    agentSoul: user.agentSoul,
  })
})

profileRouter.patch("/profile", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ProfileBody

  if (body.name === undefined && body.agentSoul === undefined) {
    return c.json({ error: "name or agentSoul is required", code: "invalid_body" }, 400)
  }

  const update: { name?: string; agentSoul?: string } = {}

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) {
      return c.json({ error: "Name is required", code: "invalid_name" }, 400)
    }
    if (name.length > 80) {
      return c.json({ error: "Name must be 80 characters or fewer", code: "invalid_name" }, 400)
    }
    update.name = name
  }

  if (body.agentSoul !== undefined) {
    const agentSoul = body.agentSoul.trim()
    if (agentSoul.length > 2000) {
      return c.json(
        { error: "Writing style must be 2000 characters or fewer", code: "invalid_agent_soul" },
        400,
      )
    }
    update.agentSoul = agentSoul
  }

  const [updated] = await db
    .update(authSchema.user)
    .set(update)
    .where(eq(authSchema.user.id, user.id))
    .returning({
      name: authSchema.user.name,
      email: authSchema.user.email,
      agentSoul: authSchema.user.agentSoul,
    })

  if (!updated) return c.json({ error: "User not found" }, 404)

  return c.json(updated)
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/routes/profile.test.ts`
Expected: PASS (7 tests: the original 2 plus the 5 new ones)

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/auth.ts apps/backend/src/routes/profile.ts apps/backend/src/routes/profile.test.ts
git commit -m "feat(backend): wire up writing style via the existing agentSoul field"
```

---

### Task 2: `SettingsMenu` component

**Files:**
- Create: `apps/landing/src/components/dashboard/SettingsMenu.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type DashboardTab = "integrations" | "memory" |
  "schedules" | "conversation" | "status" | "billing" | "profile" |
  "writing-style" | "privacy"`. `export function SettingsMenu({
  onNavigate }: { onNavigate: (tab: DashboardTab) => void }): JSX.Element`
  — consumed by Task 3.

No automated test — no React component test harness in `apps/landing`.
Verify with typecheck + lint.

- [ ] **Step 1: Write the component**

Create `apps/landing/src/components/dashboard/SettingsMenu.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Settings, Plug, Brain, User, PenLine, Code2, WalletCards, Shield, BookOpen } from "lucide-react"

export type DashboardTab =
  | "integrations"
  | "memory"
  | "schedules"
  | "conversation"
  | "status"
  | "billing"
  | "profile"
  | "writing-style"
  | "privacy"

interface MenuItem {
  label: string
  icon: typeof Plug
  onClick: () => void
}

export function SettingsMenu({ onNavigate }: { onNavigate: (tab: DashboardTab) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [open])

  function navigate(tab: DashboardTab) {
    onNavigate(tab)
    setOpen(false)
  }

  const topItems: MenuItem[] = [
    { label: "Connections", icon: Plug, onClick: () => navigate("integrations") },
    { label: "Memory", icon: Brain, onClick: () => navigate("memory") },
    { label: "Profile", icon: User, onClick: () => navigate("profile") },
    { label: "Writing style", icon: PenLine, onClick: () => navigate("writing-style") },
  ]

  const accountItems: MenuItem[] = [
    { label: "Billing", icon: WalletCards, onClick: () => navigate("billing") },
    { label: "Privacy", icon: Shield, onClick: () => navigate("privacy") },
  ]

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Settings"
      >
        <Settings size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-card shadow-lg py-1.5 z-50">
          {topItems.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors text-left"
            >
              <item.icon size={14} className="text-muted-foreground" />
              {item.label}
            </button>
          ))}
          <Link
            href="/dashboard/developer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <Code2 size={14} className="text-muted-foreground" />
            Developer
          </Link>

          <div className="my-1.5 border-t border-border" />
          <p className="px-3.5 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Account
          </p>
          {accountItems.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors text-left"
            >
              <item.icon size={14} className="text-muted-foreground" />
              {item.label}
            </button>
          ))}
          <Link
            href="/docs"
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <BookOpen size={14} className="text-muted-foreground" />
            Docs
          </Link>
        </div>
      )}
    </div>
  )
}
```

(All nine icons — `Settings`, `Plug`, `Brain`, `User`, `PenLine`, `Code2`,
`WalletCards`, `Shield`, `BookOpen` — confirmed present in the installed
`lucide-react` version before writing this plan.)

- [ ] **Step 2: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/dashboard/SettingsMenu.tsx
git commit -m "feat(landing): add SettingsMenu component"
```

---

### Task 3: Wire the menu in, split "account" into "profile"/"billing"

Both halves of this task touch the same `activeTab` type change (removing
`"account"` from the union), so they're one task, not two — splitting them
would leave a typecheck error between commits, breaking from this
session's own established practice of every task ending green.

**Files:**
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `SettingsMenu`, `type DashboardTab` from Task 2.
- Produces: `activeTab === "profile"` and `activeTab === "billing"`
  blocks — Task 4 adds a `"writing-style"` block near them, no interface
  dependency between the two.

No automated test — see Global Constraints. Verify with typecheck + lint.

- [ ] **Step 1: Import `SettingsMenu` and the `DashboardTab` type**

Find:

```tsx
import { StatusManager } from "@/components/dashboard/StatusManager"
```

Add immediately after it:

```tsx
import { SettingsMenu, type DashboardTab } from "@/components/dashboard/SettingsMenu"
```

- [ ] **Step 2: Type `activeTab` with `DashboardTab`, default to `"integrations"`**

Find:

```tsx
  const [activeTab, setActiveTab] = useState<
    "account" | "integrations" | "memory" | "schedules" | "conversation" | "status" | "privacy"
  >("account")
```

Change to:

```tsx
  const [activeTab, setActiveTab] = useState<DashboardTab>("integrations")
```

(Was `"account"` — that tab no longer exists as a direct destination.
`"integrations"` is the natural new default: it's the first tab-bar item
and the one most dashboard visits are actually for.)

- [ ] **Step 3: Shrink the tab-bar array, drop the now-unreachable `"privacy"` icon case**

Find:

```tsx
            {(
              [
                "account",
                "integrations",
                "memory",
                "schedules",
                "conversation",
                "status",
                "privacy",
              ] as const
            ).map((tab) => (
```

Change to:

```tsx
            {(
              ["integrations", "memory", "schedules", "conversation", "status"] as const
            ).map((tab) => (
```

Find:

```tsx
                {tab === "integrations" && <Plug size={13} />}
                {tab === "memory" && <Brain size={13} />}
                {tab === "schedules" && <Clock size={13} />}
                {tab === "conversation" && <MessageSquare size={13} />}
                {tab === "status" && <Activity size={13} />}
                {tab === "privacy" && <Shield size={13} />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
```

Change to:

```tsx
                {tab === "integrations" && <Plug size={13} />}
                {tab === "memory" && <Brain size={13} />}
                {tab === "schedules" && <Clock size={13} />}
                {tab === "conversation" && <MessageSquare size={13} />}
                {tab === "status" && <Activity size={13} />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
```

- [ ] **Step 4: Add the `SettingsMenu` trigger to the header**

Find:

```tsx
            {isOwner && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 font-medium">
                <Shield size={11} />
                Owner
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
```

Change to:

```tsx
            {isOwner && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 font-medium">
                <Shield size={11} />
                Owner
              </span>
            )}
            <SettingsMenu onNavigate={setActiveTab} />
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
```

- [ ] **Step 5: Retitle the block and relocate the welcome banner**

Find:

```tsx
        {/* Account tab content — only shown when account tab active */}
        {
          activeTab === "account" && (
            <>
              {/* Welcome banner — shown once after signup */}
              {showWelcome && (
```

Change to:

```tsx
        {/* Profile tab content */}
        {
          activeTab === "profile" && (
            <>
              {/* Welcome banner — shown once after signup */}
              {showWelcome && (
```

- [ ] **Step 6: Cut the billing-warnings and usage-error blocks out of the profile flow**

Find (this sits between the welcome banner's closing and the Telegram
card's opening comment):

```tsx
                </motion.div>
              )}

              {/* Billing warnings */}
              {sub?.billingWarning && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-start gap-3"
                >
                  <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-yellow-300 font-medium">Payment past due</p>
                    <p className="text-xs text-yellow-400/80">{sub.billingWarning}</p>
                  </div>
                </motion.div>
              )}

              {subLoadError && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3"
                >
                  <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-destructive font-medium">Usage data unavailable</p>
                    <p className="text-xs text-destructive/80">{subLoadError}</p>
                  </div>
                </motion.div>
              )}

              {/* Telegram */}
```

Change to (the two blocks are removed here — they're re-inserted at the
start of the new billing block in Step 3, verbatim, not deleted):

```tsx
                </motion.div>
              )}

              {/* Telegram */}
```

- [ ] **Step 7: Close the profile block after the Telegram card, open the billing block with the cut content restored**

Find (the Telegram card's closing, immediately followed by the old
account block's next section):

```tsx
                    )}
                  </div>
                </div>
              </motion.div>

              {/* Plan card */}
```

Change to:

```tsx
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )
        }

        {/* Billing tab content */}
        {
          activeTab === "billing" && (
            <>
              {/* Billing warnings */}
              {sub?.billingWarning && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-start gap-3"
                >
                  <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-yellow-300 font-medium">Payment past due</p>
                    <p className="text-xs text-yellow-400/80">{sub.billingWarning}</p>
                  </div>
                </motion.div>
              )}

              {subLoadError && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3"
                >
                  <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-destructive font-medium">Usage data unavailable</p>
                    <p className="text-xs text-destructive/80">{subLoadError}</p>
                  </div>
                </motion.div>
              )}

              {/* Plan card */}
```

Everything from the original "Plan card" comment through the original
block's end (the plan-card, usage/credits stats, recent activity, and
the "Plans — hidden for owner" grid) is now inside this new `billing`
block, completely unchanged — this edit only touches the boundary, not
that content.

- [ ] **Step 8: Retitle the trailing comment**

Find:

```tsx
            </>
          ) /* end account tab */
        }
      </main>
```

Change to:

```tsx
            </>
          ) /* end billing tab */
        }
      </main>
```

- [ ] **Step 9: Add the read-only name/email block to the top of the profile tab**

Find (the very start of the now-renamed profile block, right after its
opening):

```tsx
          activeTab === "profile" && (
            <>
              {/* Welcome banner — shown once after signup */}
```

Change to:

```tsx
          activeTab === "profile" && (
            <>
              <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {session.user.name || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{session.user.email}</p>
                </div>
              </div>

              {/* Welcome banner — shown once after signup */}
```

- [ ] **Step 10: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(landing): wire the settings menu into the dashboard header and split the account tab into profile and billing"
```

---

### Task 4: Writing style tab

**Files:**
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/user/me` (now returns `agentSoul`), `PATCH
  /api/user/profile` (now accepts `agentSoul`) — both from Task 1.
- Produces: nothing consumed elsewhere — end of the chain.

No automated test — see Global Constraints. Verify with typecheck + lint;
manual check happens in Task 5.

- [ ] **Step 1: Add state**

Find:

```tsx
  const [customMcpError, setCustomMcpError] = useState("")
```

Add immediately after it:

```tsx
  const [agentSoulDraft, setAgentSoulDraft] = useState("")
  const [agentSoulSaving, setAgentSoulSaving] = useState(false)
  const [agentSoulError, setAgentSoulError] = useState("")
```

- [ ] **Step 2: Fetch the current value on mount**

Find the custom-MCP-servers fetch effect (added in an earlier feature this
session):

```tsx
  useEffect(() => {
    if (!session) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    fetch(`${apiBase}/api/custom-mcp`, {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : { servers: [] }))
      .then((d: { servers?: CustomMcpServerInfo[] }) => {
        setCustomServers(Array.isArray(d.servers) ? d.servers : [])
      })
      .catch(() => {}) // ignore — best-effort, same as the integrations fetch above
  }, [session])
```

Add a new effect immediately after it:

```tsx
  useEffect(() => {
    if (!session) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    fetch(`${apiBase}/api/user/me`, {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { agentSoul?: string | null } | null) => {
        if (d?.agentSoul) setAgentSoulDraft(d.agentSoul)
      })
      .catch(() => {}) // ignore — best-effort, same as the fetch above
  }, [session])
```

- [ ] **Step 3: Add the save handler**

Find `handleDeleteCustomMcpServer`:

```tsx
  async function handleDeleteCustomMcpServer(id: string) {
    if (!session) return
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      await fetch(`${apiBase}/api/custom-mcp/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.session.token}` },
      })
      setCustomServers((prev) => prev.filter((s) => s.id !== id))
    } catch {
      /* best-effort */
    }
  }
```

Add immediately after it:

```tsx
  async function handleSaveAgentSoul() {
    if (!session) return
    setAgentSoulError("")
    setAgentSoulSaving(true)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      const res = await fetch(`${apiBase}/api/user/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({ agentSoul: agentSoulDraft }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
    } catch (err) {
      setAgentSoulError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setAgentSoulSaving(false)
    }
  }
```

- [ ] **Step 4: Render the tab**

Find the privacy tab block (its content is unchanged by this whole plan —
only used here as an anchor point to insert after):

```tsx
        {/* Privacy tab */}
        {activeTab === "privacy" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PrivacyManager token={session.session.token} />
          </motion.div>
        )}
```

Add immediately after it:

```tsx

        {/* Writing style tab */}
        {activeTab === "writing-style" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                Writing style
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Teach Yomi how to talk to you — e.g. &quot;always be terse, no emoji.&quot;
              </p>
              <textarea
                value={agentSoulDraft}
                onChange={(e) => setAgentSoulDraft(e.target.value)}
                placeholder="e.g. always be terse, no emoji"
                rows={4}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {agentSoulError && (
                <p className="text-xs text-destructive mt-2">{agentSoulError}</p>
              )}
              <button
                onClick={handleSaveAgentSoul}
                disabled={agentSoulSaving}
                className="mt-3 flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {agentSoulSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </motion.div>
        )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/landing/src/app/dashboard/page.tsx
git commit -m "feat(landing): add the writing style tab"
```

---

### Task 5: Whole-monorepo verification and manual check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no new errors (pre-existing warnings in unrelated files are
fine, per this session's established baseline)

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: PASS — `apps/backend` gains 5 tests in `profile.test.ts` (7
total in that file), no regressions elsewhere

- [ ] **Step 3: Attempt a manual walkthrough**

Use this project's `run` skill to start the dev server and check the
dashboard. If this environment can reach a real backend/DB and you can
sign in: confirm the gear icon opens the menu, each item navigates to the
right tab, click-outside and Escape close it, the tab bar only shows the
five unchanged tabs, Profile shows read-only name/email plus the
(visually unchanged) welcome banner and Telegram card, Billing shows the
(visually unchanged) plan/usage/plans content, and Writing style loads
any existing `agentSoul` value and saves edits.

If sign-in isn't reachable (as it wasn't in this sandbox for every prior
UI feature this session): report that clearly rather than guessing, and
tell the user this specific check needs to happen on a machine with a
real session.

- [ ] **Step 4: Final commit check**

Run: `git status --short`
Expected: clean (everything from Tasks 1–5 already committed per-task)
