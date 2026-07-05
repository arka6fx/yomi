# Spec 00 - Overview

Yomi is an AI productivity assistant for voice, text, screen Q&A, Telegram, and
connected work apps.

Core surfaces:

- Desktop shell for hotkeys, tray/notch UI, microphone capture, and
  user-initiated screen capture.
- Local sidecar for low-latency routing, fast answers, local notes, local
  memory, and connector tools.
- Cloud backend for auth, billing, Telegram, connector token access, usage
  metering, and canonical memory.
- Landing/dashboard for account, billing, downloads, bot linking, and
  integrations.

Primary paths:

- Fast path: STT or text, optional screenshot, one model call, optional TTS.
- Agent path: AI SDK loop with connector, web, file, cron, messaging, and memory
  tools.
- Telegram path: backend gateway to backend agent with connector and memory
  tools.

Durable memory is backend-canonical. The sidecar keeps local/private working
memory and syncs durable facts when signed in.
