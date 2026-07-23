# Spec 00 - Overview

Yomi is an AI productivity assistant for voice, text, screen Q&A, Telegram, and
connected work apps.

Core surfaces:

- Cloud backend for auth, billing, Telegram, connector token access, usage
  metering, canonical memory, and LLM/STT proxying.
- Landing/dashboard for account, billing, downloads, bot linking, and
  integrations.

Primary paths:

- Fast path: STT or text, optional screenshot, one model call.
- Agent path: AI SDK loop with connector, web, file, cron, messaging, and memory
  tools.
- Telegram path: backend gateway to backend agent with connector and memory
  tools.
