# Spec 04 - Desktop UI

The desktop UI is a compact notch/chat surface for voice, text, and screen answers.

States:

- `idle`
- `listening`
- `processing`
- `text-input`

Renderer events:

- `transcript`
- `llm_chunk`
- `agent_text`
- `audio_chunk`
- `tts_error`
- `usage_limit`
- `done`
- `error`

The UI shows plan status, dashboard/integration links, TTS toggle, voice/text controls, and response cards.
