# Telegram emoji reactions

## Overview

Give Yomi the ability to react to a user's Telegram message with an emoji
(Telegram's native message-reaction feature), in addition to its normal text
reply. Used sparingly and only when it fits the message — not a reaction on
every turn.

## Motivation

Yomi currently only ever replies with text. A reaction is a lightweight way to
acknowledge a message (a thumbs-up on a confirmation, a fire emoji on exciting
news) without adding another line of text, and makes the bot feel more present
on a surface (Telegram) that's built around this affordance.

## Architecture

Reuse the existing `extraTools` pattern already used for
`recall_past_conversations` and `web_search`
(`packages/agent-core/src/recall.ts`, `web-search.ts`, wired in
`apps/backend/src/agent/run.ts`). The agent gets a new tool it can call
mid-turn; the tool's `execute` fires the reaction through a callback supplied by
the caller, the same way recall/web-search wrap a caller-supplied function
instead of reaching into the DB/HTTP layer themselves.

```
Telegram update
  -> gateway-runner.ts (has msg.platform/chatId/messageId)
       passes onReact callback into runAgent()
  -> run.ts: builds react_to_message tool from onReact, adds to extraTools
  -> agent loop: model optionally calls the tool once, mid-turn
       -> onReact(emoji) -> gateway-runner.setReaction(...)
       -> TelegramAdapter.setReaction() -> POST setMessageReaction
```

Reactions are fire-and-forget: the tool call resolves immediately after kicking
off the request, never blocks the agent loop or delays the text reply, and any
Telegram API failure is logged and swallowed.

## Components

### 1. `PlatformAdapter.setReaction` + `TelegramAdapter` implementation

New method on the `PlatformAdapter` interface
(`apps/backend/src/gateway/platform-adapter.ts`):

```ts
setReaction(chatId: string, messageId: string, emoji: string): Promise<{ ok: boolean; error?: string }>
```

`TelegramAdapter.setReaction` (`apps/backend/src/gateway/platforms/telegram.ts`)
follows the exact shape of the existing `deleteMessage`/`sendTyping` methods: a
raw `fetch` to `${apiUrl}/setMessageReaction` with body
`{ chat_id, message_id, reaction: [{ type: "emoji", emoji }] }`, catching and
returning `{ ok: false, error }` on failure rather than throwing. Telegram is
the only adapter today (desktop is retired), so no other adapter needs this
method, but it belongs on the shared interface since gateway-runner dispatches
through it generically.

### 2. `react_to_message` agent tool (`packages/agent-core/src/react.ts`)

Same shape as `recall.ts`:

```ts
export type ReactFn = (emoji: string) => Promise<void>

export function createReactionTool(react: ReactFn) {
  return tool({
    description:
      "React to the user's message with an emoji, IN ADDITION to your text reply. " +
      "Use this rarely — only when a reaction genuinely fits (a clear win, a thanks, a funny " +
      "moment, a strong yes/no). Most turns should not use this tool at all.",
    parameters: z.object({
      emoji: z
        .enum([...ALLOWED_REACTIONS])
        .describe("One emoji from Telegram's allowed reaction set"),
    }),
    execute: async ({ emoji }) => {
      await react(emoji)
      return { ok: true }
    },
  })
}
```

`ALLOWED_REACTIONS` is a curated subset of Telegram's fixed reaction-emoji
allowlist (Telegram rejects anything outside it) — e.g. 👍 👎 ❤️ 🔥 🎉 😁 😢 🤔
🙏 💯 😍 🤯 👏 — verified against current Bot API docs at implementation time
rather than guessed, since a stale/wrong emoji makes the call fail silently
(swallowed per the error handling below).

### 3. Wiring in `run.ts` / `gateway-runner.ts`

- `RunAgentOptions` gets an optional `onReact?: ReactFn`.
- `runAgent` adds `react_to_message: createReactionTool(opts.onReact)` to
  `extraTools` only when `onReact` is provided (keeps the tool absent from
  non-Telegram or test call sites that don't pass it).
- `gateway-runner.ts`'s backend-agent branch (the `runAgent({...})` call around
  line 1411) passes:
  ```ts
  onReact: (emoji) =>
    this.setReaction(msg.platform, msg.chatId, msg.messageId, emoji).then(
      () => {},
    )
  ```
- New `GatewayRunner.setReaction(platform, chatId, messageId, emoji)` mirrors
  the existing `sendTyping` method: look up the adapter, call
  `adapter.setReaction(...)`, swallow errors.

## Scope

Only wired into the main backend-agent conversational path in
`gateway-runner.ts`. Not available on: control commands (`/stop`, `/new`,
`/help`), the personality-onboarding flow, or pending-approval replay — none of
those go through `runAgent`'s tool loop today, so there's no natural call site,
and reacting on those wouldn't add anything.

## Error handling

- Telegram API failure (bad emoji, message too old to react to, chat disabled
  reactions, etc.): caught in `TelegramAdapter.setReaction`, returned as
  `{ ok: false, error }`, logged with `console.warn` in
  `GatewayRunner.setReaction`, never surfaced to the user and never retried.
- The reaction call never blocks or delays the text reply — it's invoked via the
  tool's `execute` but the `react()` callback itself is not awaited by the agent
  loop's critical path beyond the tool call resolving (same fire-and-forget
  posture as `sendTyping`).

## Testing

- `TelegramAdapter.setReaction`: unit test verifying the request body shape and
  that a non-ok Telegram response surfaces as `{ ok: false }` (mirrors existing
  `deleteMessage` tests in `telegram.test.ts`).
- `createReactionTool`: unit test verifying it calls the injected `react`
  function with the model-chosen emoji (mirrors `recall.test.ts`).
- `gateway-runner.test.ts`: verify `onReact` is passed to `runAgent` on the
  backend-agent path and that `setReaction` resolves the correct adapter.

## Out of scope

- Reacting to messages on any platform other than Telegram.
- Removing/changing a previously-set reaction.
- A random/probability-based reaction mode with no content awareness (this
  design is entirely model-driven).
- Custom (non-standard) emoji reactions, which require the bot to have Telegram
  Premium-linked rights.
