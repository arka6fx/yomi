# Telegram Inline Controls + Mini-App Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Telegram's `/` slash-command popup entirely, replace
`/stop`/`/new`/`/approve`/`/deny` with tappable inline buttons on the bot's own
messages, and add a Telegram Mini App menu button that opens Yomi's existing
web dashboard, auto-signed-in.

**Architecture:** `PlatformAdapter` gains inline-keyboard support
(`sendMessage`'s `buttons` option, `editMessageText`, `answerCallbackQuery`,
`setCallbackHandler`); `TelegramAdapter` implements it and stops registering a
command list on every boot. `GatewayRunner` wraps the one long-running
operation (the full agent loop inside `onIncoming`) with a Stop-button status
message, attaches a New-chat button to the final reply, and routes button taps
(`callback_query` webhook updates) to the same approve/deny/stop/new logic the
old text commands used. A new Better Auth plugin endpoint verifies Telegram's
signed `initData`, looks up the linked account, and mints a real session so
the mini-app's dashboard opens pre-authenticated.

**Tech Stack:** Bun, TypeScript, Hono, Better Auth 1.6.11, `bun:test`, Next.js
(landing).

## Global Constraints

- Spec:
  `docs/superpowers/specs/2026-08-09-telegram-inline-controls-and-mini-app-dashboard-design.md`
  — this plan implements it, with one refinement discovered during
  implementation planning (see below); do not deviate further without
  re-checking that file.
- **Refinement over the spec:** the spec described a single placeholder
  message edited through a turn's whole lifecycle, with `activeRuns`
  widened to carry a `messageId`. Reading the actual code
  (`gateway-runner.ts`'s `onIncoming`) showed the agent loop has 8+ early-exit
  points (fast path, image, voice, document) that never touch `activeRuns` at
  all — only the real `runAgent()` call (lines ~1486-1581, the one path
  `/stop` was ever meaningful for) does. This plan scopes the Stop/New-chat
  buttons to exactly that block: a status message is sent right before the run
  starts and deleted right after it ends (success, timeout, or error), and the
  final reply gets the New-chat button. `activeRuns` stays
  `Map<string, AbortController>`, unchanged — Telegram's `callback_query`
  payload always carries its own `message.message_id`/`chat.id`, so nothing
  needs to be separately stored to know which message to edit on a button tap.
  Fast-path/image/voice replies get no Stop button (they resolve in well under
  a second; a flashing placeholder there would be worse UX, not better).
- **Approval-card buttons are attached at creation, not at turn-completion.**
  Reading `pending-actions.ts` showed `createPendingAction` already sends the
  approval card itself, synchronously, via `sendApprovalCard` — independent of
  whatever the agent's own final turn reply says. This plan attaches
  Approve/Deny buttons there directly (Task 3), not via a `RunAgentResult`
  field as the spec's first draft of the idea implied. This removes the need
  for any `RunAgentResult.newPendingActionId` field — deliberately not added.
- **Natural-language approve/deny/pending is untouched** (`gateway-runner.ts`
  lines 230-253) — only removed here: the `<id>`-suffixed explicit text form
  (`/approve <uuid>`, `deny <uuid>`, etc.) and its role in
  `formatPendingActions`'s user-facing copy. A bare `/approve`/`/deny` typed as
  text still works exactly as today, because it already flows through the
  same natural-language matcher (stripped of its leading `/` before matching)
  — there is no separate code path for it to remove.
- **`/start` and `/help` as text commands are removed**, matching the spec —
  first-contact users still get onboarded via the existing
  `advanceSoulOnboarding` flow regardless of what their first message's text
  is.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `refactor:`),
  lowercase, no full stop, max 72 chars, per `AGENTS.md`.
- Run `bun run lint` and `bun run typecheck` before the final commit of each
  task — this touches shared interfaces (`PlatformAdapter`) that ripple into
  every adapter and test double.
- Test commands, run from repo root:
  - `bun test --isolate apps/backend/src/gateway/platforms/telegram.test.ts`
    (Task 1)
  - `bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts`
    (Tasks 2, 3)
  - `bun test --isolate apps/backend/src/services/pending-actions.test.ts`
    (Task 3)
  - `bun test --isolate apps/backend/src/auth/telegram-webapp-plugin.test.ts`
    (Task 4)

---

## File Structure

- Modify: `apps/backend/src/gateway/platform-adapter.ts` — add `InlineButton`
  and `PlatformCallbackEvent` types; extend `PlatformAdapter` with
  `sendMessage`'s `buttons` option, `editMessageText`, `answerCallbackQuery`,
  `setCallbackHandler`.
- Modify: `apps/backend/src/gateway/platforms/telegram.ts` — `connect()` calls
  `deleteMyCommands`/`setChatMenuButton`; `allowed_updates` gains
  `callback_query`; `processUpdate` dispatches `callback_query` updates;
  `sendMessage` maps `buttons`; new `editMessageText`/`answerCallbackQuery`
  methods.
- Modify: `apps/backend/src/gateway/platforms/telegram.test.ts` — tests for
  all of the above.
- Modify: `apps/backend/src/gateway/gateway-runner.ts` — `registerAdapter`
  wires `setCallbackHandler`; new `deleteMessage` wrapper; `sendMessage`/
  `sendMessageAndLog` thread `buttons`; the agent-loop block gets a status
  message with a Stop button, deleted on completion, final reply gets a
  New-chat button; new `handleCallbackQuery`/`handleCallbackApproval` methods;
  `handleControlCommand` and its call site deleted; `handleApprovalCommand`'s
  `isExplicitApprovalCommand` and `<id>`-suffixed branch deleted;
  `formatPendingActions` copy updated.
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts` — `FakeAdapter`
  gains `editMessageText`/`answerCallbackQuery`/`setCallbackHandler` and
  captures buttons; the `/new`-via-text test becomes a callback-tap test; new
  tests for the Stop status message, New-chat button, and callback-driven
  approve/deny.
- Modify: `apps/backend/src/services/pending-actions.ts` — `sendApprovalCard`
  takes the action's `id` and attaches Approve/Deny buttons.
- Create: `apps/backend/src/services/pending-actions.test.ts` — tests for the
  above (first test file for this module).
- Modify: `apps/backend/package.json` — adds `zod` as an explicit dependency
  (pinned to the version `better-auth@1.6.11` itself requires).
- Create: `apps/backend/src/auth/telegram-webapp-plugin.ts` —
  `verifyTelegramInitData`, `resolveTelegramWebAppUserId`, and the
  `telegramWebAppAuth` Better Auth plugin.
- Create: `apps/backend/src/auth/telegram-webapp-plugin.test.ts` — tests for
  the two pure/DB-lookup functions above.
- Modify: `apps/backend/src/auth.ts` — registers `telegramWebAppAuth()` in
  `plugins`.
- Create: `apps/landing/src/app/telegram-app/page.tsx` — the mini-app landing
  page.

---

### Task 1: `PlatformAdapter` interface + `TelegramAdapter`

**Files:**

- Modify: `apps/backend/src/gateway/platform-adapter.ts`
- Modify: `apps/backend/src/gateway/platforms/telegram.ts`
- Modify: `apps/backend/src/gateway/platforms/telegram.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  ```ts
  export interface InlineButton {
    text: string
    callbackData: string
  }
  export interface PlatformCallbackEvent {
    chatId: string
    platformUserId: string
    messageId: string
    data: string
    callbackId: string
  }
  export interface PlatformAdapter {
    // ...existing members...
    sendMessage(
      chatId: string,
      text: string,
      options?: { replyTo?: string; buttons?: InlineButton[][] },
    ): Promise<{ ok: boolean; messageId?: string; error?: string }>
    editMessageText(
      chatId: string,
      messageId: string,
      text: string,
      options?: { buttons?: InlineButton[][] },
    ): Promise<{ ok: boolean; error?: string }>
    answerCallbackQuery(callbackId: string, text?: string): Promise<void>
    setCallbackHandler(handler: (event: PlatformCallbackEvent) => void | Promise<void>): void
  }
  ```
  Task 2 consumes `InlineButton`, `PlatformCallbackEvent`, and every new
  `PlatformAdapter` member by these exact names/signatures.

The current `apps/backend/src/gateway/platform-adapter.ts` (lines 1-25) reads:

```ts
import type { PlatformType, GatewayMessage } from "@yomi/shared"

export interface PlatformAdapter {
  readonly platform: PlatformType
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>
  sendDocument(
    chatId: string,
    documentUrl: string,
    options?: { replyTo?: string; caption?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>
  sendTyping(chatId: string): Promise<void>
  deleteMessage(chatId: string, messageId: string): Promise<{ ok: boolean; error?: string }>
  setReaction(
    chatId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: boolean; error?: string }>
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void
}
```

- [ ] **Step 1: Update the interface**

Replace that block with:

```ts
import type { PlatformType, GatewayMessage } from "@yomi/shared"

export interface InlineButton {
  text: string
  callbackData: string
}

// A tap on an inline button — carries everything the handler needs without a
// separate lookup: Telegram's callback_query payload always includes the
// message the button was attached to, so there's nothing to store ahead of
// time to know which message to edit in response.
export interface PlatformCallbackEvent {
  chatId: string
  platformUserId: string
  messageId: string
  data: string
  callbackId: string
}

export interface PlatformAdapter {
  readonly platform: PlatformType
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>
  sendDocument(
    chatId: string,
    documentUrl: string,
    options?: { replyTo?: string; caption?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>
  sendTyping(chatId: string): Promise<void>
  deleteMessage(chatId: string, messageId: string): Promise<{ ok: boolean; error?: string }>
  editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    options?: { buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; error?: string }>
  answerCallbackQuery(callbackId: string, text?: string): Promise<void>
  setReaction(
    chatId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: boolean; error?: string }>
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void
  setCallbackHandler(handler: (event: PlatformCallbackEvent) => void | Promise<void>): void
}
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/backend/src/gateway/platforms/telegram.test.ts` (after the
existing `describe("TelegramAdapter.processUpdate — location", ...)` block, at
the end of the file):

```ts
describe("TelegramAdapter.connect", () => {
  const originalFetch = globalThis.fetch
  const originalEnv = process.env["CORS_ORIGIN"]

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalEnv === undefined) delete process.env["CORS_ORIGIN"]
    else process.env["CORS_ORIGIN"] = originalEnv
  })

  it("clears the command list and registers a web_app menu button pointing at /telegram-app", async () => {
    process.env["CORS_ORIGIN"] = "https://getyomi.in"
    const calls: { url: string; body: Record<string, unknown> | null }[] = []
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url)
      calls.push({ url: urlStr, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "yomi_bot" } }), {
          status: 200,
        })
      }
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: { url: "" } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect()

    const deleteCommandsCall = calls.find((c) => c.url.includes("/deleteMyCommands"))
    expect(deleteCommandsCall).toBeDefined()

    const menuButtonCall = calls.find((c) => c.url.includes("/setChatMenuButton"))
    expect(menuButtonCall?.body).toEqual({
      menu_button: {
        type: "web_app",
        text: "Dashboard",
        web_app: { url: "https://getyomi.in/telegram-app" },
      },
    })

    const setWebhookCall = calls.find((c) => c.url.includes("/setWebhook"))
    expect(setWebhookCall?.body?.["allowed_updates"]).toEqual(["message", "callback_query"])
  })
})

describe("TelegramAdapter.processUpdate — callback_query", () => {
  it("dispatches a button tap to the callback handler with the message's own chat/message id", async () => {
    const adapter = new TelegramAdapter("dummy-token")
    const received: PlatformCallbackEvent[] = []
    adapter.setCallbackHandler((event) => {
      received.push(event)
    })

    await adapter.processUpdate({
      update_id: 10,
      callback_query: {
        id: "cbq_1",
        from: { id: 42 },
        message: { message_id: 500, chat: { id: 99, type: "private" } },
        data: "approve:11111111-1111-1111-1111-111111111111",
      },
    })

    expect(received).toEqual([
      {
        chatId: "99",
        platformUserId: "42",
        messageId: "500",
        data: "approve:11111111-1111-1111-1111-111111111111",
        callbackId: "cbq_1",
      },
    ])
  })

  it("never calls the message handler for a callback_query update", async () => {
    const { adapter, received } = makeAdapter()
    adapter.setCallbackHandler(() => {})

    await adapter.processUpdate({
      update_id: 11,
      callback_query: {
        id: "cbq_2",
        from: { id: 42 },
        message: { message_id: 501, chat: { id: 99, type: "private" } },
        data: "stop",
      },
    })

    expect(received).toHaveLength(0)
  })

  it("does nothing when a callback_query has no message (e.g. an inline query result)", async () => {
    const adapter = new TelegramAdapter("dummy-token")
    const received: PlatformCallbackEvent[] = []
    adapter.setCallbackHandler((event) => {
      received.push(event)
    })

    await adapter.processUpdate({
      update_id: 12,
      callback_query: { id: "cbq_3", from: { id: 42 }, data: "stop" },
    })

    expect(received).toHaveLength(0)
  })
})

describe("TelegramAdapter.sendMessage — buttons", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("maps buttons to Telegram's inline_keyboard/callback_data shape", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.sendMessage("42", "Working on it…", {
      buttons: [[{ text: "⏹ Stop", callbackData: "stop" }]],
    })

    expect(capturedBody?.reply_markup).toEqual({
      inline_keyboard: [[{ text: "⏹ Stop", callback_data: "stop" }]],
    })
    expect(result).toEqual({ ok: true, messageId: "5" })
  })

  it("omits reply_markup when no buttons are given", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 6 } }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.sendMessage("42", "plain text")

    expect(capturedBody?.reply_markup).toBeUndefined()
  })
})

describe("TelegramAdapter.editMessageText", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("posts the new text and buttons to editMessageText", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.editMessageText("42", "500", "Denied.", {
      buttons: [[{ text: "🔄 New chat", callbackData: "new" }]],
    })

    expect(capturedUrl).toContain("/editMessageText")
    expect(capturedBody?.chat_id).toBe("42")
    expect(capturedBody?.message_id).toBe(500)
    expect(capturedBody?.text).toBe("Denied.")
    expect(capturedBody?.reply_markup).toEqual({
      inline_keyboard: [[{ text: "🔄 New chat", callback_data: "new" }]],
    })
    expect(result).toEqual({ ok: true })
  })

  it("sends an empty inline_keyboard when no buttons are given, clearing any previous ones", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.editMessageText("42", "500", "Stopping the current operation.")

    expect(capturedBody?.reply_markup).toEqual({ inline_keyboard: [] })
  })

  it("surfaces a non-ok Telegram response as ok: false", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, description: "message to edit not found" }), {
        status: 400,
      })) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.editMessageText("42", "999", "text")

    expect(result).toEqual({ ok: false, error: "message to edit not found" })
  })
})

describe("TelegramAdapter.answerCallbackQuery", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("posts the callback_query_id to answerCallbackQuery", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.answerCallbackQuery("cbq_1")

    expect(capturedUrl).toContain("/answerCallbackQuery")
    expect(capturedBody?.callback_query_id).toBe("cbq_1")
  })

  it("never throws when the Telegram API call fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await expect(adapter.answerCallbackQuery("cbq_1")).resolves.toBeUndefined()
  })
})
```

Add `PlatformCallbackEvent` to the existing import line at the top of the
file:

```ts
import { TelegramAdapter, type TelegramUpdate } from "./telegram.js"
```

becomes:

```ts
import { TelegramAdapter, type TelegramUpdate } from "./telegram.js"
import type { PlatformCallbackEvent } from "../platform-adapter.js"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test --isolate apps/backend/src/gateway/platforms/telegram.test.ts`
Expected: FAIL to compile — `TelegramAdapter` doesn't yet implement
`editMessageText`/`answerCallbackQuery`/`setCallbackHandler`, and
`TelegramUpdate` has no `callback_query` field.

- [ ] **Step 4: Implement in `telegram.ts`**

Find the `TelegramUpdate` interface (lines 8-29) and add a `callback_query`
field:

```ts
export interface TelegramUpdate {
  update_id: number
  message?: {
    // ...unchanged...
  }
  callback_query?: {
    id: string
    from: { id: number }
    message?: { message_id: number; chat: { id: number; type: string } }
    data?: string
  }
}
```

Add the import at the top of the file:

```ts
import type { GatewayMessage, PlatformType } from "@yomi/shared"
import { humanizeDashes } from "@yomi/shared"
import type { PlatformAdapter, InlineButton, PlatformCallbackEvent } from "../platform-adapter.js"
import { markdownToTelegramHtml, truncateMessage } from "../platform-adapter.js"
```

Add a module-level helper near the top, after the `API_BASE` constant:

```ts
function toInlineKeyboard(buttons: InlineButton[][]) {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    ),
  }
}
```

Add a `callbackHandler` field next to the existing `messageHandler` field:

```ts
export class TelegramAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  readonly botToken: string
  private messageHandler: ((msg: GatewayMessage) => void | Promise<void>) | null = null
  private callbackHandler: ((event: PlatformCallbackEvent) => void | Promise<void>) | null = null
  private connected = false
  botUsername: string | null = null
```

Find `connect()` (lines 57-105). After the `getMe` block
(`console.warn(\`[gateway/telegram] connected as @${this.botUsername}\`)`) and
before the `getWebhookInfo` block, insert:

```ts
    // Clears any command list registered previously (via BotFather or an
    // earlier deploy) so the "/" autocomplete popup never reappears —
    // Telegram has no per-source command lists, the last write wins, so this
    // is self-healing on every boot rather than a one-time manual edit.
    try {
      await fetch(`${this.apiUrl}/deleteMyCommands`, { method: "POST" })
    } catch (err) {
      console.warn("[gateway/telegram] deleteMyCommands failed:", err)
    }

    const webAppBaseUrl = process.env["CORS_ORIGIN"] ?? "https://getyomi.in"
    try {
      await fetch(`${this.apiUrl}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu_button: {
            type: "web_app",
            text: "Dashboard",
            web_app: { url: `${webAppBaseUrl}/telegram-app` },
          },
        }),
      })
    } catch (err) {
      console.warn("[gateway/telegram] setChatMenuButton failed:", err)
    }
```

Find the `setWebhook` call inside `connect()`:

```ts
      const whRes = await fetch(`${this.apiUrl}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: this.webhookUrl,
          allowed_updates: ["message"],
          secret_token: this.botToken.replace(/[^A-Za-z0-9_-]/g, ""),
        }),
      })
```

Change `allowed_updates`:

```ts
      const whRes = await fetch(`${this.apiUrl}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: this.webhookUrl,
          allowed_updates: ["message", "callback_query"],
          secret_token: this.botToken.replace(/[^A-Za-z0-9_-]/g, ""),
        }),
      })
```

Add `setCallbackHandler` next to `setMessageHandler`:

```ts
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void {
    this.messageHandler = handler
  }

  setCallbackHandler(handler: (event: PlatformCallbackEvent) => void | Promise<void>): void {
    this.callbackHandler = handler
  }
```

Find the start of `processUpdate` (lines 120-124):

```ts
  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.messageHandler) return

    const msg = update.message
    if (!msg) return
```

Change it to branch on `callback_query` first:

```ts
  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      const cq = update.callback_query
      if (this.callbackHandler && cq.message) {
        await this.callbackHandler({
          chatId: String(cq.message.chat.id),
          platformUserId: String(cq.from.id),
          messageId: String(cq.message.message_id),
          data: cq.data ?? "",
          callbackId: cq.id,
        })
      }
      return
    }

    if (!this.messageHandler) return

    const msg = update.message
    if (!msg) return
```

Find `sendMessage` (lines 236-264):

```ts
  async sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const clean = markdownToTelegramHtml(truncateMessage(humanizeDashes(text)))
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: clean,
        parse_mode: "HTML",
      }
      if (options?.replyTo) body.reply_to_message_id = Number(options.replyTo)

      const res = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "send failed" }
      return { ok: true, messageId: String(data.result?.message_id ?? "") }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
```

Change the options type and add the `buttons` mapping:

```ts
  async sendMessage(
    chatId: string,
    text: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const clean = markdownToTelegramHtml(truncateMessage(humanizeDashes(text)))
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: clean,
        parse_mode: "HTML",
      }
      if (options?.replyTo) body.reply_to_message_id = Number(options.replyTo)
      if (options?.buttons) body.reply_markup = toInlineKeyboard(options.buttons)

      const res = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "send failed" }
      return { ok: true, messageId: String(data.result?.message_id ?? "") }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
```

Add two new methods after `deleteMessage` (which currently ends around line
323, right before `setReaction`):

```ts
  async editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    options?: { buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const clean = markdownToTelegramHtml(truncateMessage(humanizeDashes(text)))
      const res = await fetch(`${this.apiUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
          text: clean,
          parse_mode: "HTML",
          reply_markup: toInlineKeyboard(options?.buttons ?? []),
        }),
      })
      const data = (await res.json()) as TelegramResponse
      if (!data.ok) return { ok: false, error: data.description ?? "edit failed" }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async answerCallbackQuery(callbackId: string, text?: string): Promise<void> {
    try {
      await fetch(`${this.apiUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackId, text }),
      })
    } catch {
      // best-effort — a failed ack just leaves the client's tap spinner
      // running a little longer, it doesn't block anything downstream
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test --isolate apps/backend/src/gateway/platforms/telegram.test.ts`
Expected: PASS — all existing tests plus the new ones.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: errors in `gateway-runner.ts` and its test file (they implement
`PlatformAdapter`/`FakeAdapter` and don't have the new members yet) — Task 2
fixes those. No errors expected in `platform-adapter.ts` or `telegram.ts`
themselves.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/gateway/platform-adapter.ts apps/backend/src/gateway/platforms/telegram.ts apps/backend/src/gateway/platforms/telegram.test.ts
git commit -m "feat(gateway): add inline-button support and drop the command menu"
```

---

### Task 2: `GatewayRunner` — Stop/New-chat buttons

**Files:**

- Modify: `apps/backend/src/gateway/gateway-runner.ts`
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts`

**Interfaces:**

- Consumes: `InlineButton`, `PlatformCallbackEvent`, and the extended
  `PlatformAdapter` from Task 1.
- Produces: `deleteMessage(platform, chatId, messageId)` on `GatewayRunner`
  (public, mirrors the existing `sendMessage`/`sendTyping` wrappers) — no
  later task in this plan consumes it, but it's the natural counterpart to the
  existing wrappers and keeps `onIncoming` from reaching into
  `this.adapters.get(...)` directly.

- [ ] **Step 1: Update `FakeAdapter` and write the failing tests**

In `apps/backend/src/gateway/gateway-runner.test.ts`, update the import at the
top:

```ts
import type { PlatformAdapter } from "./platform-adapter.js"
```

becomes:

```ts
import type { PlatformAdapter, InlineButton, PlatformCallbackEvent } from "./platform-adapter.js"
```

Replace the `FakeAdapter` class (lines 256-281) entirely:

```ts
class FakeAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  messages: { chatId: string; text: string; buttons?: InlineButton[][] }[] = []
  reactions: { chatId: string; messageId: string; emoji: string }[] = []
  edits: { chatId: string; messageId: string; text: string; buttons?: InlineButton[][] }[] = []
  deletedMessageIds: string[] = []
  answeredCallbacks: string[] = []
  handler: ((msg: GatewayMessage) => void | Promise<void>) | null = null
  callbackHandler: ((event: PlatformCallbackEvent) => void | Promise<void>) | null = null
  private nextMessageId = 1
  async connect() {}
  async disconnect() {}
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void {
    this.handler = handler
  }
  setCallbackHandler(handler: (event: PlatformCallbackEvent) => void | Promise<void>): void {
    this.callbackHandler = handler
  }
  async sendMessage(chatId: string, text: string, options?: { buttons?: InlineButton[][] }) {
    const messageId = String(this.nextMessageId++)
    this.messages.push({ chatId, text, buttons: options?.buttons })
    return { ok: true, messageId }
  }
  async sendDocument() {
    return { ok: true }
  }
  async deleteMessage(_chatId: string, messageId: string) {
    this.deletedMessageIds.push(messageId)
    return { ok: true }
  }
  async editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    options?: { buttons?: InlineButton[][] },
  ) {
    this.edits.push({ chatId, messageId, text, buttons: options?.buttons })
    return { ok: true }
  }
  async answerCallbackQuery(callbackId: string) {
    this.answeredCallbacks.push(callbackId)
  }
  async sendTyping() {}
  async setReaction(chatId: string, messageId: string, emoji: string) {
    this.reactions.push({ chatId, messageId, emoji })
    return { ok: true }
  }
}
```

Replace the existing `"closes the active persisted session for /new"` test
(lines 527-546) — it typed `/new` as text, which no longer resets anything —
with a callback-driven version:

```ts
it("closes the active persisted session when the New-chat button is tapped", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "hello",
    timestamp: new Date().toISOString(),
  })
  expect(adapter.messages.at(-1)?.buttons).toEqual([[{ text: "🔄 New chat", callbackData: "new" }]])

  // FakeAdapter's message ids are assigned in send order: "1" was the status
  // placeholder (sent, then deleted once the run finished), "2" is the final
  // reply the New-chat button is actually attached to.
  await adapter.callbackHandler!({
    chatId: "chat_1",
    platformUserId: "tg_1",
    messageId: "2",
    data: "new",
    callbackId: "cbq_1",
  })

  expect(adapter.answeredCallbacks).toEqual(["cbq_1"])
  expect(closedSessions).toEqual([
    { userId: "user_1", platform: "telegram", chatId: "chat_1" },
    { userId: "user_1", platform: "yomi", chatId: "global" },
  ])
  expect(adapter.edits.at(-1)?.text).toBe("Started a new conversation. How can I help you?")
})
```

Add four new tests directly after it, still inside
`describe("GatewayRunner production routing", ...)`:

```ts
it("sends a status message with a Stop button before running the agent, and deletes it once the reply is sent", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "search my notion notes",
    timestamp: new Date().toISOString(),
  })

  expect(adapter.messages).toHaveLength(2)
  expect(adapter.messages[0]).toEqual({
    chatId: "chat_1",
    text: "⏳ Working on it…",
    buttons: [[{ text: "⏹ Stop", callbackData: "stop" }]],
  })
  expect(adapter.deletedMessageIds).toEqual(["1"])
  expect(adapter.messages[1]).toEqual({
    chatId: "chat_1",
    text: "backend reply",
    buttons: [[{ text: "🔄 New chat", callbackData: "new" }]],
  })
})

it("aborts the run when the Stop button is tapped while it's in flight", async () => {
  agentHangs = true
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)

  const runPromise = incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "do something slow",
    timestamp: new Date().toISOString(),
  })

  // Let the status message send and the runAgent mock start waiting on abort.
  await new Promise((resolve) => setTimeout(resolve, 0))

  await adapter.callbackHandler!({
    chatId: "chat_1",
    platformUserId: "tg_1",
    messageId: "1",
    data: "stop",
    callbackId: "cbq_stop",
  })
  await runPromise

  expect(adapter.answeredCallbacks).toEqual(["cbq_stop"])
  expect(adapter.edits.at(-1)).toEqual({
    chatId: "chat_1",
    messageId: "1",
    text: "Stopping the current operation.",
    buttons: undefined,
  })
  // The aborted run exits quietly — it must not also send a timeout/error message.
  expect(adapter.messages).toHaveLength(1)
})

it("tells the user nothing is running when Stop is tapped with no active run", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)

  await incoming(runner, {
    platform: "telegram",
    chatId: "chat_1",
    userId: "tg_1",
    text: "hi",
    timestamp: new Date().toISOString(),
  })

  await adapter.callbackHandler!({
    chatId: "chat_1",
    platformUserId: "tg_1",
    messageId: "999",
    data: "stop",
    callbackId: "cbq_stop2",
  })

  expect(adapter.edits.at(-1)).toEqual({
    chatId: "chat_1",
    messageId: "999",
    text: "No operation is currently running.",
    buttons: undefined,
  })
})

it("acks an unrecognized callback_data value without throwing or editing anything", async () => {
  const runner = new GatewayRunner()
  const adapter = new FakeAdapter()
  runner.registerAdapter(adapter)

  await adapter.callbackHandler!({
    chatId: "chat_1",
    platformUserId: "tg_1",
    messageId: "1",
    data: "some-future-button-type",
    callbackId: "cbq_unknown",
  })

  // Still acked (so the tap spinner clears), but nothing matches, so nothing else happens.
  expect(adapter.answeredCallbacks).toEqual(["cbq_unknown"])
  expect(adapter.edits).toHaveLength(0)
  expect(closedSessions).toHaveLength(0)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts`
Expected: FAIL to compile (`FakeAdapter` doesn't fully implement
`PlatformAdapter` until the new methods are used correctly, and
`adapter.callbackHandler` is never set because `registerAdapter` doesn't wire
it yet), then FAIL at runtime once compiling (no status message, no
New-chat button, `/new`-as-text no longer resets sessions).

- [ ] **Step 3: Implement in `gateway-runner.ts`**

Add the import for the new types at the top of the file, alongside the
existing `PlatformAdapter` import:

```ts
import type { PlatformAdapter } from "./platform-adapter.js"
```

becomes:

```ts
import type { PlatformAdapter, InlineButton, PlatformCallbackEvent } from "./platform-adapter.js"
```

Find `registerAdapter` (lines 759-762):

```ts
  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.setMessageHandler((msg) => this.onIncoming(msg))
  }
```

Wire the callback handler too:

```ts
  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.setMessageHandler((msg) => this.onIncoming(msg))
    adapter.setCallbackHandler((event) => this.handleCallbackQuery(adapter.platform, event))
  }
```

Find `sendMessage` and `sendMessageAndLog` (lines 969-996):

```ts
  async sendMessage(
    platform: PlatformType,
    chatId: string,
    text: string,
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.sendMessage(chatId, text, options)
  }

  private async sendMessageAndLog(
    platform: PlatformType,
    chatId: string,
    text: string,
    context: string,
    options?: { replyTo?: string },
  ): Promise<void> {
    const result = await this.sendMessage(platform, chatId, text, options).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
    if (!result.ok) {
      console.warn(
        `[gateway] sendMessage failed context=${context} platform=${platform} chat=${chatId}: ${result.error ?? "unknown"}`,
      )
    }
  }
```

Widen both option types and add a `deleteMessage` wrapper right after
`sendMessageAndLog`:

```ts
  async sendMessage(
    platform: PlatformType,
    chatId: string,
    text: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.sendMessage(chatId, text, options)
  }

  async deleteMessage(
    platform: PlatformType,
    chatId: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.deleteMessage(chatId, messageId)
  }

  private async sendMessageAndLog(
    platform: PlatformType,
    chatId: string,
    text: string,
    context: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<void> {
    const result = await this.sendMessage(platform, chatId, text, options).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
    if (!result.ok) {
      console.warn(
        `[gateway] sendMessage failed context=${context} platform=${platform} chat=${chatId}: ${result.error ?? "unknown"}`,
      )
    }
  }
```

Find the agent-loop block inside `onIncoming` (the `let runController` through
the end of its `catch` block, currently lines 1486-1581). Replace it in full:

```ts
      let runController: AbortController | null = null
      let runTimedOut = false
      let runTimeout: ReturnType<typeof setTimeout> | undefined
      try {
        console.warn(
          `[gateway] backend agent start user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId}`,
        )
        runController = new AbortController()
        this.activeRuns.set(this.runKey(msg.platform, msg.chatId), runController)
        // Hard cap on a single agent run. On a stateless Worker nothing else can
        // abort a hung run (the in-memory /stop and /new controllers live in other
        // isolates), so without this a stuck tool/model call would hang forever.
        const timeoutMs = Number(process.env["YOMI_AGENT_RUN_TIMEOUT_MS"] ?? 60_000)
        runTimeout = setTimeout(() => {
          runTimedOut = true
          runController?.abort()
        }, timeoutMs)
        // A real user turn is charged, so the free-resume allowance starts over.
        this.freeResumes.delete(this.runKey(msg.platform, msg.chatId))
        const result = await runAgent({
          userId: yomiUserId,
          text: msg.text,
          history,
          signal: runController.signal,
          sourcePlatform: msg.platform,
          sourceChatId: msg.chatId,
          onReact: (emoji) =>
            msg.messageId
              ? this.setReaction(msg.platform, msg.chatId, msg.messageId, emoji)
              : Promise.resolve(),
          consumePendingDocument: () => this.consumePendingDocument(msg.platform, msg.chatId),
          restorePendingDocument: (document) =>
            this.restorePendingDocument(msg.platform, msg.chatId, document),
        })
        clearTimeout(runTimeout)
        clearInterval(typingInterval)
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
        if (runController.signal.aborted) {
          if (runTimedOut) {
            await this.sendMessageAndLog(
              msg.platform,
              msg.chatId,
              AGENT_TIMEOUT_MESSAGE,
              "agent-timeout",
            )
          }
          return
        }
        console.warn(
          `[gateway] backend agent done user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId} chars=${result.text.length}`,
        )
        // Deliver the reply BEFORE persisting history: both compete for the
        // invocation's subrequest budget, and losing the user-visible reply
        // is worse than losing a history write (which has an in-memory fallback).
        const reply = result.text || "I couldn't produce a reply. Please try again."
        await this.sendMessageAndLog(msg.platform, msg.chatId, reply, "backend-agent-reply")
        if (result.text) {
          if (conversationConsent.allowed && persistentSession) {
            await appendAgentTurn({
              sessionId: persistentSession.id,
              userId: yomiUserId,
              userText: msg.text,
              assistantText: result.text,
            }).catch((err) => {
              console.warn("[gateway] append persistent session failed:", err)
              this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
            })
          } else {
            this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
          }
        }
      } catch (err) {
        if (runTimeout) clearTimeout(runTimeout)
        clearInterval(typingInterval)
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
        if (runTimedOut) {
          await this.sendMessageAndLog(
            msg.platform,
            msg.chatId,
            AGENT_TIMEOUT_MESSAGE,
            "agent-timeout",
          )
          return
        }
        if (runController?.signal.aborted) return
        console.error(
          `[gateway] runAgent error user=${yomiUserId} chat=${msg.chatId}:`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        )
        await this.sendMessageAndLog(
          msg.platform,
          msg.chatId,
          "Sorry, I ran into an error. Please try again.",
          "backend-agent-error",
        )
      }
```

becomes:

```ts
      let runController: AbortController | null = null
      let runTimedOut = false
      let runTimeout: ReturnType<typeof setTimeout> | undefined
      let statusMessageId: string | undefined
      try {
        console.warn(
          `[gateway] backend agent start user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId}`,
        )
        runController = new AbortController()
        this.activeRuns.set(this.runKey(msg.platform, msg.chatId), runController)
        // A visible placeholder with a Stop button — this is the one path a user
        // can meaningfully abort (fast/image/voice replies resolve in well under
        // a second, so they never get one). Deleted once the run settles, one way
        // or another, below.
        const statusResult = await this.sendMessage(msg.platform, msg.chatId, "⏳ Working on it…", {
          buttons: [[{ text: "⏹ Stop", callbackData: "stop" }]],
        })
        if (statusResult.ok && statusResult.messageId) statusMessageId = statusResult.messageId
        // Hard cap on a single agent run. On a stateless Worker nothing else can
        // abort a hung run (the in-memory /stop and /new controllers live in other
        // isolates), so without this a stuck tool/model call would hang forever.
        const timeoutMs = Number(process.env["YOMI_AGENT_RUN_TIMEOUT_MS"] ?? 60_000)
        runTimeout = setTimeout(() => {
          runTimedOut = true
          runController?.abort()
        }, timeoutMs)
        // A real user turn is charged, so the free-resume allowance starts over.
        this.freeResumes.delete(this.runKey(msg.platform, msg.chatId))
        const result = await runAgent({
          userId: yomiUserId,
          text: msg.text,
          history,
          signal: runController.signal,
          sourcePlatform: msg.platform,
          sourceChatId: msg.chatId,
          onReact: (emoji) =>
            msg.messageId
              ? this.setReaction(msg.platform, msg.chatId, msg.messageId, emoji)
              : Promise.resolve(),
          consumePendingDocument: () => this.consumePendingDocument(msg.platform, msg.chatId),
          restorePendingDocument: (document) =>
            this.restorePendingDocument(msg.platform, msg.chatId, document),
        })
        clearTimeout(runTimeout)
        clearInterval(typingInterval)
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
        if (runController.signal.aborted) {
          // A manual Stop tap already edited the status message itself (see
          // handleCallbackQuery) and there's nothing further to send — only a
          // timeout (which the tap could never have caused) still needs to
          // delete the untouched status message and tell the user.
          if (runTimedOut) {
            if (statusMessageId) {
              await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
            }
            await this.sendMessageAndLog(
              msg.platform,
              msg.chatId,
              AGENT_TIMEOUT_MESSAGE,
              "agent-timeout",
            )
          }
          return
        }
        if (statusMessageId) {
          await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
        }
        console.warn(
          `[gateway] backend agent done user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId} chars=${result.text.length}`,
        )
        // Deliver the reply BEFORE persisting history: both compete for the
        // invocation's subrequest budget, and losing the user-visible reply
        // is worse than losing a history write (which has an in-memory fallback).
        const reply = result.text || "I couldn't produce a reply. Please try again."
        await this.sendMessageAndLog(msg.platform, msg.chatId, reply, "backend-agent-reply", {
          buttons: [[{ text: "🔄 New chat", callbackData: "new" }]],
        })
        if (result.text) {
          if (conversationConsent.allowed && persistentSession) {
            await appendAgentTurn({
              sessionId: persistentSession.id,
              userId: yomiUserId,
              userText: msg.text,
              assistantText: result.text,
            }).catch((err) => {
              console.warn("[gateway] append persistent session failed:", err)
              this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
            })
          } else {
            this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
          }
        }
      } catch (err) {
        if (runTimeout) clearTimeout(runTimeout)
        clearInterval(typingInterval)
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
        if (runTimedOut) {
          if (statusMessageId) {
            await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
          }
          await this.sendMessageAndLog(
            msg.platform,
            msg.chatId,
            AGENT_TIMEOUT_MESSAGE,
            "agent-timeout",
          )
          return
        }
        // A manual Stop tap already edited the status message itself — stop quietly.
        if (runController?.signal.aborted) return
        if (statusMessageId) {
          await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
        }
        console.error(
          `[gateway] runAgent error user=${yomiUserId} chat=${msg.chatId}:`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        )
        await this.sendMessageAndLog(
          msg.platform,
          msg.chatId,
          "Sorry, I ran into an error. Please try again.",
          "backend-agent-error",
        )
      }
```

Find the call site of `handleControlCommand` (lines 1184-1189):

```ts
      // Control commands (/stop /new /help) are handled locally — no LLM needed.
      const controlReply = await this.handleControlCommand(msg, session, yomiUserId)
      if (controlReply) {
        await this.sendMessage(msg.platform, msg.chatId, controlReply).catch(() => {})
        return
      }
```

Delete it entirely (no replacement — nothing left calls
`handleControlCommand`).

Find `handleControlCommand` itself (lines 1647-1706) and delete the whole
method:

```ts
  private async handleControlCommand(
    msg: GatewayMessage,
    _session: GatewaySession,
    yomiUserId: string,
  ): Promise<string | null> {
    // ...entire body...
  }
```

Add the two new methods right after `resolveYomiUserId` (which currently ends
around line 1620, just before `private getOrCreateSession`):

```ts
  private async handleCallbackQuery(
    platform: PlatformType,
    event: PlatformCallbackEvent,
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return

    const yomiUserId = await this.resolveYomiUserId(platform, event.platformUserId)
    await adapter.answerCallbackQuery(event.callbackId).catch(() => {})
    if (!yomiUserId) return

    if (event.data === "stop") {
      const key = this.runKey(platform, event.chatId)
      const controller = this.activeRuns.get(key)
      if (!controller) {
        await adapter
          .editMessageText(event.chatId, event.messageId, "No operation is currently running.")
          .catch(() => {})
        return
      }
      controller.abort()
      this.activeRuns.delete(key)
      await adapter
        .editMessageText(event.chatId, event.messageId, "Stopping the current operation.")
        .catch(() => {})
      return
    }

    if (event.data === "new") {
      const key = this.runKey(platform, event.chatId)
      const controller = this.activeRuns.get(key)
      if (controller) {
        controller.abort()
        this.activeRuns.delete(key)
      }
      const session = this.sessions.get(`${platform}:${event.chatId}`)
      if (session) {
        session.messageCount = 0
        session.createdAt = Date.now()
        session.lastActivityAt = Date.now()
      }
      this.clearHistory(platform, event.chatId)
      await closeAgentSession({ userId: yomiUserId, platform, chatId: event.chatId }).catch(
        (err) => {
          console.warn("[gateway] close persistent session failed:", err)
        },
      )
      await closeAgentSession({
        userId: yomiUserId,
        platform: SHARED_SESSION_PLATFORM,
        chatId: SHARED_SESSION_CHAT_ID,
      }).catch((err) => {
        console.warn("[gateway] close shared session failed:", err)
      })
      await adapter
        .editMessageText(
          event.chatId,
          event.messageId,
          "Started a new conversation. How can I help you?",
        )
        .catch(() => {})
      return
    }

    const approveMatch = /^approve:([0-9a-f-]{36})$/i.exec(event.data)
    if (approveMatch?.[1]) {
      await this.handleCallbackApproval(
        platform,
        event.chatId,
        event.messageId,
        yomiUserId,
        approveMatch[1],
        true,
      )
      return
    }
    const denyMatch = /^deny:([0-9a-f-]{36})$/i.exec(event.data)
    if (denyMatch?.[1]) {
      await this.handleCallbackApproval(
        platform,
        event.chatId,
        event.messageId,
        yomiUserId,
        denyMatch[1],
        false,
      )
    }
  }

  // `executed` drives the resume the same way handleApprovalCommand's text path
  // does: an approved write is one step of the agent's plan, so the loop is
  // re-entered afterwards or everything the agent meant to do next is lost.
  private async handleCallbackApproval(
    platform: PlatformType,
    chatId: string,
    messageId: string,
    yomiUserId: string,
    actionId: string,
    approve: boolean,
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    const { approvePendingAction, denyPendingAction, formatActionResult } = await import(
      "../services/pending-actions.js"
    )

    if (!approve) {
      try {
        const denied = await denyPendingAction(yomiUserId, actionId)
        const text = denied
          ? "Denied."
          : "I couldn't find that pending action. It may have expired or already been handled."
        await adapter.editMessageText(chatId, messageId, text).catch(() => {})
      } catch (err) {
        console.warn("[gateway] deny pending action failed:", err)
        await adapter
          .editMessageText(chatId, messageId, "Deny failed. Please try again.")
          .catch(() => {})
      }
      return
    }

    try {
      const result = await approvePendingAction(yomiUserId, actionId, { skipNotify: true })
      if (!result) {
        await adapter
          .editMessageText(
            chatId,
            messageId,
            "I couldn't find that pending action. It may have expired or already been handled.",
          )
          .catch(() => {})
        return
      }
      if (result.status !== "executed") {
        await adapter
          .editMessageText(
            chatId,
            messageId,
            formatActionResult(result.result, `That didn't work: ${result.status}`),
          )
          .catch(() => {})
        return
      }
      const reply = `Approved and executed.\n${formatActionResult(result.result, `Done: ${result.title ?? "action"}`)}`
      await adapter.editMessageText(chatId, messageId, reply).catch(() => {})
      await this.resumeAfterApproval(
        {
          platform,
          chatId,
          userId: "",
          text: "approve",
          timestamp: new Date().toISOString(),
        },
        yomiUserId,
        reply,
      )
    } catch (err) {
      await adapter
        .editMessageText(
          chatId,
          messageId,
          `Approval failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        .catch(() => {})
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts`
Expected: PASS — all existing tests plus the new ones. (`approvePendingAction`
in this test file's `mock.module("../services/pending-actions.js", ...)`
already ignores its third argument, so passing `{ skipNotify: true }` from
`handleCallbackApproval` doesn't need a mock change.)

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/gateway/gateway-runner.ts apps/backend/src/gateway/gateway-runner.test.ts
git commit -m "feat(gateway): replace /stop and /new with inline buttons"
```

---

### Task 3: Approve/Deny buttons on the approval card

**Files:**

- Modify: `apps/backend/src/services/pending-actions.ts`
- Create: `apps/backend/src/services/pending-actions.test.ts`
- Modify: `apps/backend/src/gateway/gateway-runner.ts`
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts`

**Interfaces:**

- Consumes: `GatewayRunner.sendMessage`'s `buttons` option (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test for `pending-actions.ts`**

Create `apps/backend/src/services/pending-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectResult: { id: string; status: string }[] = []
let insertedRows: Record<string, unknown>[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResult) }),
    }),
  }),
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      insertedRows.push(row)
      return { returning: () => Promise.resolve([{ id: "action-1", status: "pending" }]) }
    },
  }),
}
mock.module("@yomi/db", () => ({ db: fakeDb, pendingActions: {} }))

let sentMessages: {
  platform: string
  chatId: string
  text: string
  options?: { buttons?: { text: string; callbackData: string }[][] }
}[] = []
mock.module("../gateway/index.js", () => ({
  getDefaultGateway: () => ({
    sendMessage: async (
      platform: string,
      chatId: string,
      text: string,
      options?: { buttons?: { text: string; callbackData: string }[][] },
    ) => {
      sentMessages.push({ platform, chatId, text, options })
      return { ok: true }
    },
  }),
}))

const { createPendingAction } = await import("./pending-actions.js")

beforeEach(() => {
  selectResult = []
  insertedRows = []
  sentMessages = []
})

describe("createPendingAction", () => {
  it("attaches Approve/Deny inline buttons carrying the new action's id", async () => {
    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail.sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: a@example.com",
      payload: {},
      sourcePlatform: "telegram",
      sourceChatId: "chat_1",
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.platform).toBe("telegram")
    expect(sentMessages[0]?.chatId).toBe("chat_1")
    expect(sentMessages[0]?.options?.buttons).toEqual([
      [
        { text: "✅ Approve", callbackData: "approve:action-1" },
        { text: "❌ Deny", callbackData: "deny:action-1" },
      ],
    ])
  })

  it("sends no card when sourcePlatform/sourceChatId are missing", async () => {
    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail.sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: a@example.com",
      payload: {},
    })

    expect(sentMessages).toHaveLength(0)
  })

  it("sends no new card for a duplicate in-flight request for the same action", async () => {
    selectResult = [{ id: "existing-action", status: "pending" }]

    await createPendingAction({
      userId: "user_1",
      connector: "google",
      action: "gmail.sendEmail",
      risk: "send",
      title: "Send email",
      preview: "To: a@example.com",
      payload: {},
      sourcePlatform: "telegram",
      sourceChatId: "chat_1",
    })

    expect(sentMessages).toHaveLength(0)
    expect(insertedRows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test --isolate apps/backend/src/services/pending-actions.test.ts`
Expected: FAIL — the first test's `options?.buttons` assertion fails, since
`sendApprovalCard` doesn't attach buttons yet.

- [ ] **Step 3: Implement in `pending-actions.ts`**

Find `createPendingAction`'s call to `sendApprovalCard`:

```ts
  // Send the card ourselves rather than trusting the model to relay it. The model was
  // told to summarise "in one short line", so it compressed the recipient, subject and
  // body out of existence — the user was approving an email they could not see. An
  // approval gate that hides what it is approving is not a safety mechanism, so this
  // is awaited: the card IS the gate, not a nicety to fire and forget.
  await sendApprovalCard(input.sourcePlatform, input.sourceChatId, input.title, input.preview)
```

Change it to pass the new row's id:

```ts
  // Send the card ourselves rather than trusting the model to relay it. The model was
  // told to summarise "in one short line", so it compressed the recipient, subject and
  // body out of existence — the user was approving an email they could not see. An
  // approval gate that hides what it is approving is not a safety mechanism, so this
  // is awaited: the card IS the gate, not a nicety to fire and forget.
  await sendApprovalCard(input.sourcePlatform, input.sourceChatId, row.id, input.title, input.preview)
```

Find `sendApprovalCard`:

```ts
async function sendApprovalCard(
  sourcePlatform: string | undefined,
  sourceChatId: string | undefined,
  title: string,
  preview?: string,
): Promise<void> {
  if (!sourcePlatform || !sourceChatId) return
  try {
    const { getDefaultGateway } = await import("../gateway/index.js")
    await getDefaultGateway().sendMessage(
      sourcePlatform as "telegram",
      sourceChatId,
      formatApprovalCard(title, preview),
    )
  } catch (err) {
    // The action still exists and the tool result carries the details, but the user
    // did not see the card — worth knowing about.
    console.warn(
      "[pending-actions] failed to send approval card:",
      err instanceof Error ? err.message : String(err),
    )
  }
}
```

Replace it:

```ts
async function sendApprovalCard(
  sourcePlatform: string | undefined,
  sourceChatId: string | undefined,
  actionId: string,
  title: string,
  preview?: string,
): Promise<void> {
  if (!sourcePlatform || !sourceChatId) return
  try {
    const { getDefaultGateway } = await import("../gateway/index.js")
    await getDefaultGateway().sendMessage(
      sourcePlatform as "telegram",
      sourceChatId,
      formatApprovalCard(title, preview),
      {
        buttons: [
          [
            { text: "✅ Approve", callbackData: `approve:${actionId}` },
            { text: "❌ Deny", callbackData: `deny:${actionId}` },
          ],
        ],
      },
    )
  } catch (err) {
    // The action still exists and the tool result carries the details, but the user
    // did not see the card — worth knowing about.
    console.warn(
      "[pending-actions] failed to send approval card:",
      err instanceof Error ? err.message : String(err),
    )
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test --isolate apps/backend/src/services/pending-actions.test.ts`
Expected: PASS — 3 tests, 0 fail.

- [ ] **Step 5: Delete the now-redundant explicit-id text command, and simplify
      around it**

In `apps/backend/src/gateway/gateway-runner.ts`, find `handleApprovalCommand`
(the whole method). The first part (unchanged, keep as-is):

```ts
  private async handleApprovalCommand(
    userId: string,
    text: string,
  ): Promise<{ reply: string; executed: boolean } | null> {
    const trimmed = text.trim()
    const command = trimmed.replace(/^\//, "").trim()
    const isExplicitApprovalCommand = /^\/(approve|yes|deny|no)$/i.test(trimmed)
    // A trailing modifier means the user is amending, not approving
    // ("yes but change the time to 7") — those must reach the agent, not approve.
    const hasModifier =
      /\b(but|instead|change|wait|actually|except|hold on|don'?t|do not|no,|rather|make it)\b/i.test(
        command,
      )
```

Find where `isExplicitApprovalCommand` is used:

```ts
    if (/^(pending|approvals|pending approvals)$/i.test(command)) {
      return { reply: await this.formatPendingActions(userId), executed: false }
    }

    if (wantsApprove || wantsDeny) {
      // ...
      if (actions.length === 0)
        return isExplicitApprovalCommand
          ? { reply: "No pending approvals.", executed: false }
          : null
```

Delete the now-unused `isExplicitApprovalCommand` declaration, and simplify
its one use site to match the natural-language behavior it now shares with
"yes"/"no" (nothing pending → fall through to the agent, don't special-case
the empty-pending message):

```ts
  private async handleApprovalCommand(
    userId: string,
    text: string,
  ): Promise<{ reply: string; executed: boolean } | null> {
    const trimmed = text.trim()
    const command = trimmed.replace(/^\//, "").trim()
    // A trailing modifier means the user is amending, not approving
    // ("yes but change the time to 7") — those must reach the agent, not approve.
    const hasModifier =
      /\b(but|instead|change|wait|actually|except|hold on|don'?t|do not|no,|rather|make it)\b/i.test(
        command,
      )
```

```ts
    if (actions.length === 0) return null
```

Find the id-suffixed explicit-command branch — everything from the `match =`
line to the end of the method:

```ts
    const match = /^(?:\/)?(approve|confirm|send|deny|reject|cancel)\s+([0-9a-f-]{36})$/i.exec(
      trimmed,
    )
    if (!match) return null
    const actionCommand = match[1]?.toLowerCase()
    const id = match[2]
    if (!actionCommand || !id) return null

    if (actionCommand === "approve" || actionCommand === "confirm" || actionCommand === "send") {
      try {
        const { approvePendingAction, formatActionResult } =
          await import("../services/pending-actions.js")
        const result = await approvePendingAction(userId, id, { skipNotify: true })
        if (!result)
          return {
            reply:
              "I couldn't find that pending action. It may have expired or already been handled.",
            executed: false,
          }
        if (result.status !== "executed")
          return { reply: `Approved: ${result.status}`, executed: false }
        return {
          reply: `Approved and executed.\n${formatActionResult(result.result, `Done: ${result.title ?? "action"}`)}`,
          executed: true,
        }
      } catch (err) {
        return {
          reply: `Approval failed: ${err instanceof Error ? err.message : String(err)}`,
          executed: false,
        }
      }
    }

    try {
      const { denyPendingAction } = await import("../services/pending-actions.js")
      const denied = await denyPendingAction(userId, id)
      if (!denied)
        return {
          reply:
            "I couldn't find that pending action. It may have expired or already been handled.",
          executed: false,
        }
      return { reply: "Denied.", executed: false }
    } catch (err) {
      console.warn("[gateway] deny pending action failed:", err)
      return { reply: "Deny failed. Please try again.", executed: false }
    }
  }
```

Delete all of it and close the function right after the `wantsApprove ||
wantsDeny` block instead — equivalent logic now lives in `handleCallbackApproval`
(Task 2), reachable via the Approve/Deny buttons this task just added:

```ts
    return null
  }
```

Find `formatPendingActions`:

```ts
  private async formatPendingActions(userId: string): Promise<string> {
    try {
      const { listPendingActions } = await import("../services/pending-actions.js")
      const actions = await listPendingActions(userId)
      if (actions.length === 0) return "No pending approvals."
      return actions
        .map((a) => `${a.id}\n${a.title}\n${a.preview}\nReply: approve ${a.id} or deny ${a.id}`)
        .join("\n\n")
    } catch (err) {
      console.warn("[gateway] pending approvals unavailable:", err)
      return "Pending approvals are temporarily unavailable. Please try again in a moment."
    }
  }
```

The `${a.id}\nReply: approve ${a.id} or deny ${a.id}` line described the
now-deleted explicit-id command — each action already got its own
Approve/Deny buttons when it was created (this task's Step 3). Replace with:

```ts
  private async formatPendingActions(userId: string): Promise<string> {
    try {
      const { listPendingActions } = await import("../services/pending-actions.js")
      const actions = await listPendingActions(userId)
      if (actions.length === 0) return "No pending approvals."
      const list = actions.map((a) => `${a.title}\n${a.preview}`).join("\n\n")
      return `${list}\n\nReply "yes" to approve the most recent one, or tap Approve/Deny on its message above.`
    } catch (err) {
      console.warn("[gateway] pending approvals unavailable:", err)
      return "Pending approvals are temporarily unavailable. Please try again in a moment."
    }
  }
```

- [ ] **Step 6: Run the gateway-runner tests to verify they still pass**

Run: `bun test --isolate apps/backend/src/gateway/gateway-runner.test.ts`
Expected: PASS — the two existing `/approve` tests (bare text, no id suffix)
are unaffected, since they were always routed through the natural-language
matcher, not the deleted branch.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/services/pending-actions.ts apps/backend/src/services/pending-actions.test.ts apps/backend/src/gateway/gateway-runner.ts apps/backend/src/gateway/gateway-runner.test.ts
git commit -m "feat(gateway): attach approve/deny buttons to approval cards"
```

---

### Task 4: Telegram Mini App auto-auth (Better Auth plugin)

**Files:**

- Create: `apps/backend/src/auth/telegram-webapp-plugin.ts`
- Create: `apps/backend/src/auth/telegram-webapp-plugin.test.ts`
- Modify: `apps/backend/src/auth.ts`

**Interfaces:**

- Consumes: `db`, `platformConnections` from `@yomi/db` (existing);
  `createAuthEndpoint`, `APIError` from `better-auth/api`; `setSessionCookie`
  from `better-auth/cookies` — all confirmed present in the installed
  `better-auth@1.6.11` (`createAuthEndpoint`/`APIError` re-exported from
  `dist/api/index.mjs`; `setSessionCookie` from `dist/cookies/index.mjs`; the
  session-minting pattern —
  `ctx.context.internalAdapter.createSession(userId)` +
  `ctx.context.internalAdapter.findUserById(userId)` +
  `setSessionCookie(ctx, { session, user })` — mirrors exactly what
  `dist/oauth2/link-account.mjs`'s `handleOAuthUserInfo` and
  `dist/api/routes/callback.mjs` already do for social sign-in).
- Produces:
  ```ts
  export function verifyTelegramInitData(
    initData: string,
    botToken: string,
  ): { telegramUserId: string } | null
  export function resolveTelegramWebAppUserId(telegramUserId: string): Promise<string | null>
  export function telegramWebAppAuth(): { id: string; endpoints: Record<string, unknown> }
  ```
  Task 5 (the landing page) consumes the resulting endpoint's URL,
  `POST /api/auth/telegram-webapp-auth`, and its JSON response shape
  `{ ok: true; linked: boolean }` (or a thrown `APIError` on an invalid
  signature/misconfiguration) — not the TypeScript exports directly, since
  Task 5 is a separate Next.js app that only ever talks to this over HTTP.

- [ ] **Step 1: Add `zod` as an explicit `apps/backend` dependency**

`createAuthEndpoint`'s `body` option needs a Zod schema, and `better-auth@1.6.11`
requires `zod@^4.3.6` internally (confirmed in its own `package.json`) — the
workspace already has both `zod@3.25.76` (declared by `packages/agent-core`,
used by `index_document`'s tool schema) and `zod@4.4.3` installed side by
side. `apps/backend` currently declares no `zod` dependency of its own at
all, so without an explicit entry, resolving `import { z } from "zod"` from
inside `apps/backend/src` would be left to whatever the package manager
happens to hoist — passing a v3 schema into a v4-expecting internal API risks
a shape mismatch. Pin it explicitly to the version Better Auth itself needs.

In `apps/backend/package.json`, find the `dependencies` block:

```json
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1094.0",
    "@aws-sdk/s3-request-presigner": "^3.1094.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@yomi/agent-core": "workspace:*",
    "@yomi/db": "workspace:*",
    "@yomi/shared": "workspace:*",
    "ai": "^4.0.0",
    "better-auth": "1.6.11",
    "drizzle-orm": "^0.31.0",
    "hono": "^4.5.0"
  },
```

Add `zod` at the end (alphabetically last):

```json
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1094.0",
    "@aws-sdk/s3-request-presigner": "^3.1094.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@yomi/agent-core": "workspace:*",
    "@yomi/db": "workspace:*",
    "@yomi/shared": "workspace:*",
    "ai": "^4.0.0",
    "better-auth": "1.6.11",
    "drizzle-orm": "^0.31.0",
    "hono": "^4.5.0",
    "zod": "^4.3.6"
  },
```

Run `bun install` from the repo root afterward so the lockfile picks it up.

- [ ] **Step 2: Write the failing tests**

Create `apps/backend/src/auth/telegram-webapp-plugin.test.ts`:

```ts
import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectResult: { userId: string }[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResult) }),
    }),
  }),
}
mock.module("@yomi/db", () => ({ db: fakeDb, platformConnections: {} }))

const { verifyTelegramInitData, resolveTelegramWebAppUserId } = await import(
  "./telegram-webapp-plugin.js"
)

beforeEach(() => {
  selectResult = []
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
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
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

    expect(verifyTelegramInitData(initData, botToken)).toEqual({ telegramUserId: "42" })
  })

  it("rejects a tampered hash", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      botToken,
    )
    const tampered = initData.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64))

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
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)) }, botToken)

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
`bun test --isolate apps/backend/src/auth/telegram-webapp-plugin.test.ts`
Expected: FAIL — `./telegram-webapp-plugin.js` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `apps/backend/src/auth/telegram-webapp-plugin.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto"
import { createAuthEndpoint, APIError } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"
import { db, platformConnections } from "@yomi/db"
import { eq, and } from "drizzle-orm"

// Telegram recommends treating initData as stale past a short window — this
// is a Mini App auto-login, not a long-lived credential, so 24 hours is
// generous rather than tight.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60

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
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")

  let hashesMatch: boolean
  try {
    hashesMatch = timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(hash, "hex"))
  } catch {
    // Buffer.from throws on a malformed (non-hex or wrong-length) hash — not a match.
    hashesMatch = false
  }
  if (!hashesMatch) return null

  const authDate = Number(params.get("auth_date"))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null

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
export async function resolveTelegramWebAppUserId(telegramUserId: string): Promise<string | null> {
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

// Lets the Telegram Mini App dashboard (apps/landing's /telegram-app) sign a
// user in automatically instead of running a full OAuth flow inside Telegram's
// in-app browser. Registers POST /api/auth/telegram-webapp-auth.
export const telegramWebAppAuth = () => ({
  id: "telegram-webapp-auth",
  endpoints: {
    telegramWebAppAuth: createAuthEndpoint(
      "/telegram-webapp-auth",
      { method: "POST", body: z.object({ initData: z.string().min(1) }) },
      async (ctx) => {
        const botToken = process.env["TELEGRAM_BOT_TOKEN"]
        if (!botToken) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Telegram not configured" })
        }

        const verified = verifyTelegramInitData(ctx.body.initData, botToken)
        if (!verified) {
          throw new APIError("UNAUTHORIZED", { message: "Invalid Telegram signature" })
        }

        const userId = await resolveTelegramWebAppUserId(verified.telegramUserId)
        if (!userId) return ctx.json({ ok: true, linked: false })

        const user = await ctx.context.internalAdapter.findUserById(userId)
        if (!user) return ctx.json({ ok: true, linked: false })

        const session = await ctx.context.internalAdapter.createSession(userId)
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" })
        }

        await setSessionCookie(ctx, { session, user })
        return ctx.json({ ok: true, linked: true })
      },
    ),
  },
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
`bun test --isolate apps/backend/src/auth/telegram-webapp-plugin.test.ts`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 6: Register the plugin**

In `apps/backend/src/auth.ts`, add the import alongside the existing plugin
imports:

```ts
import { organization } from "better-auth/plugins/organization"
import { bearer } from "better-auth/plugins/bearer"
import { customSession } from "better-auth/plugins/custom-session"
```

becomes:

```ts
import { organization } from "better-auth/plugins/organization"
import { bearer } from "better-auth/plugins/bearer"
import { customSession } from "better-auth/plugins/custom-session"
import { telegramWebAppAuth } from "./auth/telegram-webapp-plugin.js"
```

Find the `plugins: [...]` array:

```ts
    plugins: [
      organization(), // Team tier: orgs + members + roles
      bearer(), // Accept Authorization: Bearer <token> from landing proxy
      customSession(async (session) => {
```

Add the new plugin:

```ts
    plugins: [
      organization(), // Team tier: orgs + members + roles
      bearer(), // Accept Authorization: Bearer <token> from landing proxy
      telegramWebAppAuth(), // POST /api/auth/telegram-webapp-auth — Mini App auto-login
      customSession(async (session) => {
```

- [ ] **Step 7: Typecheck and run the full backend suite**

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun test --isolate apps/backend/src`
Expected: all pass (confirms registering the plugin didn't break
`getRuntimeAuthConfig`/existing auth tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/package.json bun.lock apps/backend/src/auth/telegram-webapp-plugin.ts apps/backend/src/auth/telegram-webapp-plugin.test.ts apps/backend/src/auth.ts
git commit -m "feat(auth): add telegram mini app auto-login endpoint"
```

- [ ] **Step 9: Manual verification (not automated — needs a real Telegram
      client and a real linked account)**

The session-minting half of the endpoint
(`ctx.context.internalAdapter.createSession`/`findUserById` +
`setSessionCookie`) calls into Better Auth's internal request-context
machinery, which isn't meaningfully mockable without re-implementing Better
Auth itself — Steps 1-4 above cover the security-critical and independently
testable parts (signature verification, account lookup) with real unit tests.
Once Task 5 ships, confirm by opening the bot's Dashboard menu button from a
Telegram account already linked via `/link`: the mini-app should land
directly on `/dashboard`, no login prompt.

---

### Task 5: Landing mini-app page

**Files:**

- Create: `apps/landing/src/app/telegram-app/page.tsx`

**Interfaces:**

- Consumes: `POST /api/auth/telegram-webapp-auth` from Task 4 (returns
  `{ ok: true; linked: boolean }`, sets a session cookie on `linked: true`);
  `process.env.NEXT_PUBLIC_BACKEND_URL`, the same env var
  `apps/landing/src/lib/auth-client.ts` already uses for the Better Auth base
  URL.
- Produces: nothing consumed elsewhere in this plan — this is the page the
  Task 1 menu button (`web_app: { url: "${webAppBaseUrl}/telegram-app" }`)
  opens.

- [ ] **Step 1: Write the page**

Create `apps/landing/src/app/telegram-app/page.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void } }
  }
}

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
          const res = await fetch(`${backendUrl}/api/auth/telegram-webapp-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ initData }),
          })
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

- [ ] **Step 2: Typecheck and lint the landing app**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/app/telegram-app/page.tsx
git commit -m "feat(landing): add telegram mini app auto-login page"
```

- [ ] **Step 4: Manual verification (not automated — see spec's Testing
      section)**

`window.Telegram.WebApp.initData` only populates meaningfully inside a real
Telegram client. Once Tasks 1-4 are deployed, verify from an actual Telegram
account: tapping the Dashboard menu button on a linked account lands on
`/dashboard` signed in with no login prompt; on an unlinked account, it shows
the "isn't linked" fallback with a working link to `/link`.

---

## Final Verification

- [ ] Run `bun run format` proactively before pushing, then re-verify tests
      still pass.
- [ ] Run `bun run lint` from repo root.
- [ ] Run `bun run typecheck` from repo root — 0 errors.
- [ ] Run `bun test --isolate` (full monorepo suite) from repo root — all
      pass.
- [ ] Re-read
      `docs/superpowers/specs/2026-08-09-telegram-inline-controls-and-mini-app-dashboard-design.md`
      and confirm every section has a corresponding implemented piece, noting
      the one deliberate refinement recorded in this plan's Global
      Constraints.
- [ ] Manually confirm no remaining references to the deleted
      `handleControlCommand` method or the `<id>`-suffixed approve/deny text
      regex anywhere in the codebase:
      `grep -rn "handleControlCommand\|approve|confirm|send|deny|reject|cancel)\\\\s" apps/backend/src/gateway/gateway-runner.ts`
      should show nothing beyond what typecheck already caught.
- [ ] Deploy and run the Task 4/5 manual verification steps against a real
      Telegram account before considering this feature done — this is the one
      part of the plan that cannot be confirmed by the test suite alone.
