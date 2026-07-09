import { Hono } from "hono"

export const proxyRouter = new Hono()

// Legacy cloud LLM and STT/TTS proxy routes are disabled.
// Desktop inference runs through the local sidecar:
// - LLM: OpenAI / OpenAI-compatible endpoint
// - STT/TTS: ElevenLabs
