import { Hono } from "hono"

export const proxyRouter = new Hono()

// Legacy cloud LLM and STT/TTS proxy routes are disabled.
// Desktop inference runs through the local sidecar:
// - LLM: AWS Bedrock MiniMax M2.5
// - STT/TTS: AWS Bedrock Nova Sonic
