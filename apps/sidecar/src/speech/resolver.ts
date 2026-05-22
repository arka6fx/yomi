import OpenAI from "openai"

// TTS uses its own key/URL so audio can go to real OpenAI while LLM uses a proxy
function getOpenAI(): OpenAI {
  return new OpenAI({
    apiKey: process.env.TTS_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.TTS_BASE_URL,
  })
}

export type TtsEngine = "openai" | "none"

export function resolveTts(): TtsEngine {
  const explicit = process.env.TTS_ENGINE?.toLowerCase() as TtsEngine | undefined
  if (explicit === "openai" || explicit === "none") return explicit
  if (process.env.OPENAI_API_KEY) return "openai"
  return "none"
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  if (resolveTts() === "none") return
  const model = process.env.TTS_MODEL || "gpt-4o-mini-tts"
  const resp = await getOpenAI().audio.speech.create({
    model,
    voice: "alloy",
    input: text,
    response_format: "mp3",
  })
  const buf = Buffer.from(await resp.arrayBuffer())
  yield new Uint8Array(buf)
}
