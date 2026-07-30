# Retire the desktop client: Telegram is the only interaction surface

Status: accepted

## Decision

Yomi retires its desktop client and the sidecar it drove. The product's single
**interaction surface** is now Telegram — text, voice messages, and images the
user sends. The web app is a **management dashboard** (account linking,
schedules, memory, privacy, billing), not a chat surface, and no web chat is
planned. The connector agents, durable memory, billing, and the Telegram gateway
are unchanged; this decision is about which client surfaces reach them.

Concretely, the desktop-era surface is removed from this repo: the standalone
`/api/stt` and `/api/tts` HTTP routes with their `speech-auth` middleware and
`SIDECAR_SECRET` (the deleted sidecar was their only caller), the `ScreenImage`
/ `screenshot_b64` screen-capture request types in `@yomi/shared`, and the empty
`apps/sidecar` directory. The desktop app itself was already deleted in an
earlier commit.

## Why

The desktop client and its sidecar were a capture-and-relay surface — global
hotkey, screen and microphone capture, device-code OAuth — that carried a large
share of the maintenance and OAuth-verification burden while the actual
assistant value had consolidated on the backend + Telegram path. Rather than
keep a client we no longer ship, we make the pivot explicit: one surface, fully
owned.

The voice and image _capabilities_ survive because they live on the Telegram
path, not on desktop. The Telegram gateway transcribes inbound voice messages
directly via `services/transcription`; it analyzes images the user sends. So
"retire desktop" is a surface removal, not a capability loss — the `transcribe*`
service and the `voice` (2/min) and `analyze` (1) credit kinds all stay. Only
the desktop-only _screen capture_ is gone; the credit description "image/screen
analyze" becomes "image analyze".

> **Superseded (2026-07-2x, see commit `344da121`):** voice _replies_ (TTS,
> `services/tts`, `synthesizeSpeech`) were removed outright afterward — Yomi now
> transcribes inbound voice but never synthesizes spoken replies; every reply is
> text. The `transcribe*` half of the paragraph above still holds.

## Consequences

- The `voice` and `analyze` credit _kinds_ are unchanged in code; only prose
  (`AGENTS.md`, landing copy) drops the "screen" framing. Screen capture is no
  longer a billable or offered capability.
- The `screenshot`/`screenshots` keys stay in `ai-telemetry`'s
  `BLOCKED_METADATA_KEYS` denylist — that is a privacy backstop, not a desktop
  coupling, and removing them would only ever weaken it.
- `FastQueryRequest` / `AgentQueryRequest` / `RouterInput` in `@yomi/shared` are
  the old desktop HTTP request contract and now have no importers. They are left
  in place (minus their screen fields) as harmless dead types; removing the
  husks is a separate dead-code pass, not part of this pivot.
- Reversing this — reintroducing a desktop client — means rebuilding the sidecar
  capture pipeline, the device-code OAuth flow, and the speech routes from
  scratch, which is why the pivot is recorded here rather than left implicit.
