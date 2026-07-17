import { Hono } from "hono"

export const proxyRouter = new Hono()

// Legacy cloud LLM and STT/TTS proxy routes are disabled.
