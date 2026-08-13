# Telegram Mini App Dashboard Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Telegram Mini App's Dashboard button is tapped by an
already-linked user, open `/dashboard` authenticated in a real external browser,
instead of trying (and failing) to keep the user signed in inside Telegram's own
embedded webview.

**Architecture:** `POST /api/auth/telegram-webapp-auth`'s linked branch stops
minting a session cookie inside the calling iframe and instead mints a
single-use, short-lived login token (new DB table) and returns a redeem URL. The
Mini App page opens that URL in a real external browser via
`Telegram.WebApp.openLink()`. A new `GET /api/auth/telegram-webapp-redeem`
endpoint — reached by that external browser's own request, a separate process
with its own cookie jar — atomically claims the token, mints a real session
there, and redirects to `/dashboard`.

**Tech Stack:** Bun, TypeScript, Hono, Better Auth 1.6.11, Drizzle ORM
(PostgreSQL), `bun:test`, Next.js (landing).

## Global Constraints

- Spec:
  `docs/superpowers/specs/2026-08-12-telegram-miniapp-dashboard-handoff-design.md`
  — this plan implements it; do not deviate without re-checking that file.
- The "not yet linked" path (`/telegram-app`'s unlinked fallback → `/link` →
  `/signin` → OAuth) is explicitly out of scope — do not touch it.
- Token expiry: 2 minutes. Single-use, enforced via an atomic
  `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING ...`, not a
  separate read-then-write.
- `expired_link` is the one error code for all three "can't redeem" cases
  (missing, expired, already-used) — the user-facing outcome is identical for
  all three, so don't distinguish them in the UI.
- Test command: `bun test --isolate` (or `bun run test --isolate` for a whole
  package) — this repo's actual convention; bare `bun test` causes cross-file
  mock pollution and spurious failures.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`), lowercase, no full
  stop, max 72 chars.
- Migrations are a manual step: `bun run db:migrate` from `packages/db` must be
  run after Task 1 lands, separately from the code deploy (code deploys
  automatically on push to `main`, migrations do not).

---

## File Structure

- Modify: `packages/db/src/schema.ts` — add `telegramMiniappLoginTokens` table.
- Create: `packages/db/drizzle/0035_telegram_miniapp_login_tokens.sql` —
  migration.
- Modify: `packages/db/drizzle/meta/_journal.json` — register the migration.
- Modify: `apps/backend/src/auth/telegram-webapp-plugin.ts` — linked branch of
  `telegram-webapp-auth` mints a token instead of a cookie; new
  `telegram-webapp-redeem` endpoint.
- Modify: `apps/backend/src/auth/telegram-webapp-plugin.test.ts` — tests for
  both.
- Modify: `apps/landing/src/app/telegram-app/page.tsx` — linked branch opens
  externally instead of `router.replace`; new `"opened"` status screen.

---

### Task 1: DB table for single-use login tokens

**Files:**

- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0035_telegram_miniapp_login_tokens.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**

- Consumes: `users` (existing stub table in `schema.ts`, `users.id` is `uuid`).
- Produces: `export const telegramMiniappLoginTokens: PgTable` with columns
  `token` (text, PK), `userId` (uuid, FK to `users.id`, cascade delete),
  `expiresAt` (timestamp, not null), `usedAt` (timestamp, nullable). Task 2
  consumes this by name, imported from `@yomi/db`.

- [ ] **Step 1: Add the table to `schema.ts`**

Find the end of the `devices` table definition in `packages/db/src/schema.ts`
(currently lines 45-53):

```ts
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  os: text("os").notNull(), // "windows"
  appVersion: text("app_version").notNull(),
  sidecarUrl: text("sidecar_url"), // Legacy field for the desktop sidecar URL
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
})
```

Add a new table directly after it:

```ts
// Single-use, short-lived login tokens for the Telegram Mini App dashboard
// handoff (see docs/superpowers/specs/2026-08-12-telegram-miniapp-dashboard-handoff-design.md).
// A token minted here is claimed exactly once, by
// GET /api/auth/telegram-webapp-redeem running in a real external browser —
// a cookie minted inside Telegram's own embedded webview never reaches that
// browser, so this table is the bridge between the two contexts.
export const telegramMiniappLoginTokens = pgTable(
  "telegram_miniapp_login_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
  },
)
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/db && bun run typecheck` Expected: PASS, 0 errors.

- [ ] **Step 3: Write the migration SQL**

Create `packages/db/drizzle/0035_telegram_miniapp_login_tokens.sql`:

```sql
CREATE TABLE IF NOT EXISTS "telegram_miniapp_login_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_miniapp_login_tokens" ADD CONSTRAINT "telegram_miniapp_login_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

This matches the exact style of the most recent `CREATE TABLE` migration in this
repo (`packages/db/drizzle/0032_custom_mcp_servers.sql`): tab-indented columns,
`--> statement-breakpoint` separator, and a
`DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$;`-guarded FK so
re-running the migration is idempotent.

- [ ] **Step 4: Register the migration in the journal**

Find the end of `packages/db/drizzle/meta/_journal.json`'s `entries` array
(currently ends with the `0034_pending_connector_nudge` entry):

```json
    {
      "idx": 34,
      "version": "7",
      "when": 1786320000000,
      "tag": "0034_pending_connector_nudge",
      "breakpoints": true
    }
  ]
}
```

Add a new entry after it (comma after the `0034` entry's closing brace):

```json
    {
      "idx": 34,
      "version": "7",
      "when": 1786320000000,
      "tag": "0034_pending_connector_nudge",
      "breakpoints": true
    },
    {
      "idx": 35,
      "version": "7",
      "when": 1786406400000,
      "tag": "0035_telegram_miniapp_login_tokens",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0035_telegram_miniapp_login_tokens.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): add telegram mini-app login tokens table"
```

Note: this migration is NOT applied to any live database as part of this task —
`bun run db:migrate` is a separate manual step per the Global Constraints, run
once after this whole plan merges.

---

### Task 2: Backend — token-mint + redeem endpoints

**Files:**

- Modify: `apps/backend/src/auth/telegram-webapp-plugin.ts`
- Modify: `apps/backend/src/auth/telegram-webapp-plugin.test.ts`

**Interfaces:**

- Consumes: `telegramMiniappLoginTokens` (`@yomi/db`, Task 1);
  `ctx.context.internalAdapter.createSession`/`findUserById`, `setSessionCookie`
  (existing, already used by this file); `ctx.redirect(url)` (Better Auth's
  `createAuthEndpoint` context method — confirmed present in the installed
  `better-auth@1.6.11` via `dist/api/routes/callback.mjs`'s own
  `throw c.redirect(...)` usage, same shape this task uses).
- Produces: `POST /api/auth/telegram-webapp-auth`'s linked-branch JSON response
  gains a `redeemUrl: string` field (replacing the `Set-Cookie` it used to
  send). New `GET /api/auth/telegram-webapp-redeem?token=<token>` endpoint — no
  JSON response on success/failure, always a redirect (302). Task 3 consumes
  `redeemUrl` from the auth endpoint's response by that exact name.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of
`apps/backend/src/auth/telegram-webapp-plugin.test.ts` with (this keeps all
existing `verifyTelegramInitData`/`resolveTelegramWebAppUserId` tests unchanged
and adds new ones for the redeem endpoint's pure claim logic):

```ts
import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectResult: { userId: string }[] = []
let claimResult: { userId: string }[] = []
let claimedTokens: string[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResult) }),
    }),
  }),
  insert: () => ({
    values: () => Promise.resolve(undefined),
  }),
  update: () => ({
    set: () => ({
      where: (whereArg: unknown) => {
        // The real query filters on token = $1 AND used_at IS NULL AND
        // expires_at > now() — the fake can't evaluate a drizzle where
        // expression, so it just records that an update was attempted and
        // returns whatever the test pre-set as the claim result.
        claimedTokens.push(String(whereArg))
        return { returning: () => Promise.resolve(claimResult) }
      },
    }),
  }),
}
mock.module("@yomi/db", () => ({
  db: fakeDb,
  platformConnections: {},
  telegramMiniappLoginTokens: {
    token: "token",
    userId: "user_id",
    usedAt: "used_at",
    expiresAt: "expires_at",
  },
}))

const { verifyTelegramInitData, resolveTelegramWebAppUserId, claimLoginToken } =
  await import("./telegram-webapp-plugin.js")

beforeEach(() => {
  selectResult = []
  claimResult = []
  claimedTokens = []
})

// Builds a validly-signed initData string the way Telegram's client does,
// so tests exercise the real verification algorithm end to end rather than
// a shortcut.
function signInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const params = new URLSearchParams(fields)
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest()
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex")
  params.set("hash", hash)
  return params.toString()
}

describe("verifyTelegramInitData", () => {
  const botToken = "test-bot-token"

  it("accepts a validly-signed initData string and extracts the telegram user id", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42, first_name: "Ada" }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      botToken,
    )

    expect(verifyTelegramInitData(initData, botToken)).toEqual({
      telegramUserId: "42",
    })
  })

  it("rejects a tampered hash", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      botToken,
    )
    const tampered = initData.replace(
      /hash=[0-9a-f]+/,
      "hash=" + "0".repeat(64),
    )

    expect(verifyTelegramInitData(tampered, botToken)).toBeNull()
  })

  it("rejects initData signed with a different bot token", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      "a-different-token",
    )

    expect(verifyTelegramInitData(initData, botToken)).toBeNull()
  })

  it("rejects initData with no hash at all", () => {
    const params = new URLSearchParams({ user: JSON.stringify({ id: 42 }) })
    expect(verifyTelegramInitData(params.toString(), botToken)).toBeNull()
  })

  it("rejects an auth_date older than 24 hours", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000) - 25 * 60 * 60),
      },
      botToken,
    )

    expect(verifyTelegramInitData(initData, botToken)).toBeNull()
  })

  it("rejects initData with no user field", () => {
    const initData = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)) },
      botToken,
    )

    expect(verifyTelegramInitData(initData, botToken)).toBeNull()
  })
})

describe("resolveTelegramWebAppUserId", () => {
  it("returns the linked Yomi user id when the Telegram id is linked", async () => {
    selectResult = [{ userId: "user_1" }]

    expect(await resolveTelegramWebAppUserId("42")).toBe("user_1")
  })

  it("returns null when the Telegram id has no linked account", async () => {
    selectResult = []

    expect(await resolveTelegramWebAppUserId("42")).toBeNull()
  })
})

describe("claimLoginToken", () => {
  it("returns the userId when the atomic claim update returns a row", async () => {
    claimResult = [{ userId: "user_1" }]

    expect(await claimLoginToken("tok_valid")).toBe("user_1")
    expect(claimedTokens).toHaveLength(1)
  })

  it("returns null when the claim update returns no rows (missing, expired, or already used)", async () => {
    claimResult = []

    expect(await claimLoginToken("tok_gone")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`cd apps/backend && bun test --isolate src/auth/telegram-webapp-plugin.test.ts`
Expected: FAIL — `claimLoginToken` is not exported yet, and
`telegramMiniappLoginTokens` doesn't exist in `@yomi/db` until Task 1's schema
change is picked up (Task 1 should already be merged/committed before this task
starts).

- [ ] **Step 3: Implement**

Replace the entire contents of
`apps/backend/src/auth/telegram-webapp-plugin.ts`:

```ts
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto"
import { createAuthEndpoint, APIError } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"
import { db, platformConnections, telegramMiniappLoginTokens } from "@yomi/db"
import { eq, and, isNull, gt } from "drizzle-orm"

// Telegram recommends treating initData as stale past a short window — this
// is a Mini App auto-login, not a long-lived credential, so 24 hours is
// generous rather than tight.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60

// A login token is a bridge between Telegram's embedded webview and a real
// external browser — see docs/superpowers/specs/2026-08-12-telegram-miniapp-dashboard-handoff-design.md.
// Kept short: long enough to cover the user tapping through, short enough to
// bound exposure if the URL somehow leaked.
const LOGIN_TOKEN_TTL_MS = 2 * 60 * 1000

function webOrigin(): string {
  return process.env["CORS_ORIGIN"] ?? "https://getyomi.in"
}

// Verifies a Telegram Mini App's initData per Telegram's documented algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Never trusts the payload's own claims (including the user id) until the HMAC
// signature — keyed by the bot token, which only this backend and Telegram
// know — checks out.
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): { telegramUserId: string } | null {
  const params = new URLSearchParams(initData)
  const hash = params.get("hash")
  if (!hash) return null
  params.delete("hash")

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest()
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex")

  let hashesMatch: boolean
  try {
    hashesMatch = timingSafeEqual(
      Buffer.from(computedHash, "hex"),
      Buffer.from(hash, "hex"),
    )
  } catch {
    // Buffer.from silently truncates malformed hex rather than throwing; it's
    // timingSafeEqual that throws when the two buffers end up different
    // lengths — either way, that means no match.
    hashesMatch = false
  }
  if (!hashesMatch) return null

  const authDate = Number(params.get("auth_date"))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS)
    return null

  const userRaw = params.get("user")
  if (!userRaw) return null
  try {
    const user = JSON.parse(userRaw) as { id?: number }
    if (typeof user.id !== "number") return null
    return { telegramUserId: String(user.id) }
  } catch {
    return null
  }
}

// Pulled out from the endpoint below so it's testable without spinning up a
// full Better Auth request context — it's a plain DB lookup.
export async function resolveTelegramWebAppUserId(
  telegramUserId: string,
): Promise<string | null> {
  const [connection] = await db
    .select({ userId: platformConnections.userId })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.platform, "telegram"),
        eq(platformConnections.platformUserId, telegramUserId),
      ),
    )
    .limit(1)
  return connection?.userId ?? null
}

// Atomically claims a login token: a single UPDATE ... WHERE ... RETURNING,
// not a separate read-then-write, so a raced double-redemption (e.g. a
// double-tap that fires two requests) can't claim the same token twice.
// Returns the token's userId on a successful claim, null if the token is
// missing, already used, or expired — all three collapse to the same
// "start over" outcome from the caller's side.
export async function claimLoginToken(token: string): Promise<string | null> {
  const [claimed] = await db
    .update(telegramMiniappLoginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(telegramMiniappLoginTokens.token, token),
        isNull(telegramMiniappLoginTokens.usedAt),
        gt(telegramMiniappLoginTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: telegramMiniappLoginTokens.userId })
  return claimed?.userId ?? null
}

// Lets the Telegram Mini App dashboard (apps/landing's /telegram-app) sign a
// user in automatically instead of running a full OAuth flow inside Telegram's
// in-app browser. Registers:
//   POST /api/auth/telegram-webapp-auth   — verify initData, mint a redeem URL
//   GET  /api/auth/telegram-webapp-redeem — claim the token, mint a real
//                                            session, redirect to /dashboard
// The two are split because they run in different browser contexts: the POST
// runs inside Telegram's own embedded webview (which is why it can't just set
// a cookie and be done — that cookie would never reach a real external
// browser), the GET runs in the external browser Telegram.WebApp.openLink()
// opens, which is where the session actually needs to live.
export const telegramWebAppAuth = () => ({
  id: "telegram-webapp-auth",
  endpoints: {
    telegramWebAppAuth: createAuthEndpoint(
      "/telegram-webapp-auth",
      { method: "POST", body: z.object({ initData: z.string().min(1) }) },
      async (ctx) => {
        const botToken = process.env["TELEGRAM_BOT_TOKEN"]
        if (!botToken) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Telegram not configured",
          })
        }

        const verified = verifyTelegramInitData(ctx.body.initData, botToken)
        if (!verified) {
          throw new APIError("UNAUTHORIZED", {
            message: "Invalid Telegram signature",
          })
        }

        const userId = await resolveTelegramWebAppUserId(
          verified.telegramUserId,
        )
        if (!userId) return ctx.json({ ok: true, linked: false })

        const token = randomBytes(32).toString("base64url")
        await db.insert(telegramMiniappLoginTokens).values({
          token,
          userId,
          expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
        })

        return ctx.json({
          ok: true,
          linked: true,
          redeemUrl: `${ctx.context.baseURL}/telegram-webapp-redeem?token=${token}`,
        })
      },
    ),
    telegramWebAppRedeem: createAuthEndpoint(
      "/telegram-webapp-redeem",
      { method: "GET", query: z.object({ token: z.string().min(1) }) },
      async (ctx) => {
        const userId = await claimLoginToken(ctx.query.token)
        if (!userId) {
          throw ctx.redirect(`${webOrigin()}/link?error=expired_link`)
        }

        const user = await ctx.context.internalAdapter.findUserById(userId)
        if (!user) {
          throw ctx.redirect(`${webOrigin()}/link?error=expired_link`)
        }

        const session = await ctx.context.internalAdapter.createSession(userId)
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create session",
          })
        }

        await setSessionCookie(ctx, { session, user })
        throw ctx.redirect(`${webOrigin()}/dashboard`)
      },
    ),
  },
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
`cd apps/backend && bun test --isolate src/auth/telegram-webapp-plugin.test.ts`
Expected: PASS — 10 tests, 0 fail (6 existing + 2 new `claimLoginToken` cases;
the count also includes the 2 `resolveTelegramWebAppUserId` tests already
present).

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && bun run typecheck` Expected: 0 errors.
`ctx.redirect(url)` and the `query: z.object({...})` / `ctx.query.token` pattern
are both confirmed present in the installed `better-auth@1.6.11`
(`dist/api/routes/callback.mjs`'s `throw c.redirect(...)`,
`dist/api/routes/email-verification.mjs`'s `verifyEmail` endpoint's
`query: z.object({ token: z.string()... })`), so a type error here means a real
mismatch worth investigating, not a stale assumption to route around with
`as any`.

- [ ] **Step 6: Run the full backend test suite**

Run: `cd apps/backend && bun test --isolate` Expected: PASS, 0 fail — confirms
nothing else that imports `telegram-webapp-plugin.ts` (i.e. `auth.ts`, which
registers `telegramWebAppAuth()`) broke.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/auth/telegram-webapp-plugin.ts apps/backend/src/auth/telegram-webapp-plugin.test.ts
git commit -m "feat(auth): mini-app dashboard handoff via single-use token"
```

---

### Task 3: Mini App page — open externally instead of same-frame redirect

**Files:**

- Modify: `apps/landing/src/app/telegram-app/page.tsx`

**Interfaces:**

- Consumes: `openExternal` (`@/lib/telegram-webapp`, already shipped in commit
  `2bc810a`); the auth endpoint's `redeemUrl` field from Task 2's response
  shape.
- Produces: nothing consumed by a later task — this is the last task with code
  changes in this plan.

- [ ] **Step 1: Update the page**

The current `apps/landing/src/app/telegram-app/page.tsx` reads:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import "@/lib/telegram-webapp"

type Status = "loading" | "unlinked" | "error"

export default function TelegramAppPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>("loading")

  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://telegram.org/js/telegram-web-app.js"
    script.async = true
    script.onload = () => {
      void (async () => {
        window.Telegram?.WebApp?.ready?.()
        const initData = window.Telegram?.WebApp?.initData
        if (!initData) {
          setStatus("error")
          return
        }
        try {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""
          const res = await fetch(
            `${backendUrl}/api/auth/telegram-webapp-auth`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ initData }),
            },
          )
          const data = (await res.json()) as { ok: boolean; linked?: boolean }
          if (data.ok && data.linked) {
            router.replace("/dashboard")
          } else {
            setStatus("unlinked")
          }
        } catch {
          setStatus("error")
        }
      })()
    }
    script.onerror = () => setStatus("error")
    document.body.appendChild(script)
    return () => {
      document.body.removeChild(script)
    }
  }, [router])

  if (status === "unlinked") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Your Telegram account isn&apos;t linked to a Yomi account yet.
        </p>
        <a href="/link" className="text-sm font-medium text-primary underline">
          Link your account
        </a>
      </main>
    )
  }

  if (status === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t open the dashboard. Please try again from Telegram.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  )
}
```

Replace it in full:

```tsx
"use client"

import { useEffect, useState } from "react"
import { openExternal } from "@/lib/telegram-webapp"

type Status = "loading" | "unlinked" | "error" | "opened"

export default function TelegramAppPage() {
  const [status, setStatus] = useState<Status>("loading")
  const [redeemUrl, setRedeemUrl] = useState<string | null>(null)

  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://telegram.org/js/telegram-web-app.js"
    script.async = true
    script.onload = () => {
      void (async () => {
        window.Telegram?.WebApp?.ready?.()
        const initData = window.Telegram?.WebApp?.initData
        if (!initData) {
          setStatus("error")
          return
        }
        try {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""
          const res = await fetch(
            `${backendUrl}/api/auth/telegram-webapp-auth`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ initData }),
            },
          )
          const data = (await res.json()) as {
            ok: boolean
            linked?: boolean
            redeemUrl?: string
          }
          if (data.ok && data.linked && data.redeemUrl) {
            openExternal(data.redeemUrl)
            setRedeemUrl(data.redeemUrl)
            setStatus("opened")
          } else {
            setStatus("unlinked")
          }
        } catch {
          setStatus("error")
        }
      })()
    }
    script.onerror = () => setStatus("error")
    document.body.appendChild(script)
    return () => {
      document.body.removeChild(script)
    }
  }, [])

  if (status === "opened") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Opened your dashboard in the browser — tap back to chat.
        </p>
        {redeemUrl && (
          <a
            href={redeemUrl}
            className="text-sm font-medium text-primary underline"
          >
            Didn&apos;t open? Tap here
          </a>
        )}
      </main>
    )
  }

  if (status === "unlinked") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Your Telegram account isn&apos;t linked to a Yomi account yet.
        </p>
        <a href="/link" className="text-sm font-medium text-primary underline">
          Link your account
        </a>
      </main>
    )
  }

  if (status === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t open the dashboard. Please try again from Telegram.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  )
}
```

Notes on this diff:

- `useRouter`/`router` are removed entirely — this page no longer performs any
  same-frame navigation on the linked path, which is the whole point of this
  plan. Removing the now-unused import avoids an eslint `no-unused-vars`
  failure.
- The `"opened"` screen always renders a manual `redeemUrl` link underneath the
  primary message — this is the fallback for when `Telegram.WebApp.openLink`
  isn't available (old client), since `openExternal()` falls back to
  `window.location.href = url` in that case, which would navigate the CURRENT
  iframe to the redeem URL rather than opening a new context. Showing the link
  either way costs nothing and gives the user a manual escape hatch without
  needing to detect which case occurred.

- [ ] **Step 2: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint` Expected: 0 errors.

- [ ] **Step 3: Run the landing test suite**

Run: `cd apps/landing && bun run test` Expected: PASS — this page has no
dedicated test file (Telegram's `initData`/`WebApp` only populate meaningfully
inside a real Telegram client, matching this repo's existing convention for this
exact file), so this just confirms nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/app/telegram-app/page.tsx
git commit -m "feat(landing): open mini-app dashboard handoff externally"
```

---

### Task 4: End-to-end manual verification

No code changes — confirms the full path works together, since Telegram's
`initData`/`WebApp` APIs only populate meaningfully inside a real Telegram
client (matching this repo's established convention for this exact feature).

- [ ] **Step 1: Run the full workspace suite, typecheck, lint, and format**

Run (from repo root):
`bun run test && bun run typecheck && bun run lint && bun run format:check`
Expected: PASS across all packages touched (`packages/db`, `apps/backend`,
`apps/landing`).

- [ ] **Step 2: Apply the migration to the target database**

Run: `cd packages/db && bun run db:migrate` Expected:
`0035_telegram_miniapp_login_tokens` shows as applied;
`SELECT * FROM telegram_miniapp_login_tokens LIMIT 1;` succeeds (empty result,
table exists).

- [ ] **Step 3: Verify on Telegram Web/Desktop**

With a test account whose Telegram is already linked (`platformConnections`,
`platform = "telegram"`): open the bot, tap the Dashboard menu button. Confirm:

- The Mini App briefly shows "Loading…" then "Opened your dashboard in the
  browser — tap back to chat."
- A genuinely separate browser tab/window opened, landed on `/dashboard`, and is
  signed in — no login prompt.
- Reloading `/dashboard` in that same external tab stays signed in (the session
  cookie persisted normally, since it was minted in that browser's own context).
- Tapping the same Dashboard button again mints a fresh token and opens a fresh
  tab — the previous token is already consumed and can't be reused (confirm by
  reloading the OLD redeem URL from browser history: it should redirect to
  `/link?error=expired_link`, not sign in again).

- [ ] **Step 4: Verify on a mobile Telegram client**

Same steps as Step 3, on iOS or Android. This was already working before this
plan (mobile clients auto-promote the old same-frame redirect to an external
context) — confirm it's still working now that the mechanism changed, and that
it's not worse (e.g. an extra visible redirect hop) than before.

- [ ] **Step 5: Verify the unlinked path is unaffected**

With a test account whose Telegram is linked to no Yomi account: tap the
Dashboard menu button. Confirm the existing "not linked yet" fallback still
shows, unchanged — this plan's Global Constraints explicitly excluded this path
from any change.

- [ ] **Step 6: Final commit (only if verification surfaced a real defect)**

Only if manual verification surfaced a real defect (not a hypothetical one) —
fix it, re-verify, and commit separately with a `fix:` message describing what
broke.
