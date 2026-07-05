# Yomi Reliability And UX Fix Plan

> Status: implemented (historical plan). Billing is now **pure credits** —
> per-feature limits were removed entirely (not just collapsed). Current
> pricing/enforcement: spec 13.

## Goals

- Improve Desktop and Telegram voice quality without requiring an ElevenLabs
  upgrade.
- Keep conversation context continuous across Telegram and Desktop until the
  user runs `/new`.
- Make Telegram linking truthful: the UI must only show connected after the
  backend has a connection row.
- Support Telegram image analysis and voice-note replies.
- Make connector auth failures actionable instead of vague unauthorized loops.
- Keep Dodo subscription plans and credit packs unchanged, but simplify
  dashboard metering around credits.

## Phase 1: Immediate Production Fixes

- Apply missing DB migrations for `pending_actions` and `agent_sessions` before
  bot commands depend on them.
- Make `/pending`, `/approve`, and `/deny` degrade gracefully when approval
  storage is unavailable.
- Make `/new` abort active runs and close the shared conversation session.
- Replace raw Telegram bot links with the secure deep-link token flow.
- Acceptance: `/pending` returns `No pending approvals` when empty, `/new`
  resets context once, and `/link` confirms only after `platform_connections`
  exists.

## Phase 2: Voice Quality

- Use ElevenLabs Starter-compatible quality: `mp3_44100_128` instead of
  low-bitrate `mp3_22050_32`.
- Keep `eleven_flash_v2_5` for low latency and lower credit usage.
- Enable `apply_text_normalization: auto` for better pronunciation.
- Use environment-driven voice settings with natural defaults: stability `0.45`,
  similarity `0.85`, style `0.15`, speaker boost on.
- Acceptance: Desktop TTS and Telegram voice replies use the same backend
  settings and are configurable via env.

## Phase 3: Shared Conversation Context

- Backend Telegram sessions use one per-user shared thread: `platform=yomi`,
  `chatId=global`.
- `/new` closes that shared thread.
- Next step: Desktop sidecar should fetch and append the same cloud thread using
  the authenticated session token, replacing process-local-only history.
- Acceptance: A Telegram follow-up can refer to prior Telegram turns. After
  Desktop cloud sync, Desktop and Telegram can refer to each other’s turns.

## Phase 4: Telegram Media

- Accept Telegram photos and image documents.
- Download the Telegram file and analyze it with the vision-capable AI Credits
  model.
- If the user asks for voice, synthesize the reply and send `sendVoice`.
- Acceptance: Sending a photo with “what is this?” returns a concise visual
  answer. “reply in voice” sends a Telegram voice note.

## Phase 5: Connector Auth

- Add health checks for OAuth connectors so dashboard can distinguish
  `connected` from `needs_reconnect`.
- For Notion specifically, call `/users/me` or a low-cost search with the saved
  token before showing healthy.
- In agent replies, shorten auth errors to: “Notion needs reconnect. Open
  Dashboard → Integrations → Reconnect Notion.”
- Acceptance: A revoked Notion token is shown as reconnect-required in dashboard
  before the user asks Telegram.

## Phase 6: Dashboard Metering

- Do not change Explore, Pro, Max, or credit-pack Dodo product IDs.
- Show one primary credit meter: `credits used / total credits`, plus available
  balance.
- Keep credit packs visible only on Pro and Max.
- Show a compact cost legend: AI chat 1 credit, Telegram bot 1 credit,
  image/screen analysis 1 credit, voice 2 credits/minute.
- Move detailed feature limits to a secondary or collapsed section so dashboard
  focuses on credits.
- Acceptance: users understand what consumed credits without seeing multiple
  competing meters.

## Phase 7: Production Rollout

- Run package typechecks and targeted tests.
- Deploy backend first, then landing.
- Verify `/api/gateway/status`, Telegram webhook, `/link`, and `/dashboard`.
- Reconnect Telegram for `contact.arkagarai@gmail.com` and verify the DB row.
