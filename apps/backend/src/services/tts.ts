export interface TtsOptions {
  voiceId: string
  modelId?: string
  voiceSettings?: {
    stability?: number
    similarity_boost?: number
    style?: number
    use_speaker_boost?: boolean
  }
}

export interface TtsResult {
  audio: ArrayBuffer
  contentType: string
}

const DEFAULT_MODEL = "eleven_flash_v2_5"
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
const OPENAI_DEFAULT_TTS_MODEL = "gpt-4o-mini-tts"
const OPENAI_DEFAULT_VOICE = "alloy"

function apiKey(): string {
  const key = process.env["ELEVENLABS_API_KEY"]
  if (!key) throw new Error("ELEVENLABS_API_KEY not configured")
  return key
}

function openaiKey(): string | null {
  return process.env["OPENAI_API_KEY"] || process.env["OPENAI_API_KEY"] || null
}

function openaiBase(): string {
  return (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(/\/+$/, "")
}

export function defaultVoiceId(): string {
  return process.env["ELEVENLABS_VOICE_ID"] || "EXAVITQu4vr4xnSDxMaL"
}

export function defaultVoiceSettings() {
  return {
    stability: Number(process.env["ELEVENLABS_STABILITY"] ?? "0.45"),
    similarity_boost: Number(process.env["ELEVENLABS_SIMILARITY_BOOST"] ?? "0.85"),
    style: Number(process.env["ELEVENLABS_STYLE"] ?? "0.15"),
    use_speaker_boost: process.env["ELEVENLABS_SPEAKER_BOOST"] !== "0",
  }
}

async function synthesizeOpenAI(text: string): Promise<TtsResult> {
  const key = openaiKey()
  if (!key) throw new Error("OpenAI key not set")
  const res = await fetch(`${openaiBase()}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env["OPENAI_TTS_MODEL"] || OPENAI_DEFAULT_TTS_MODEL,
      input: text,
      voice: process.env["OPENAI_TTS_VOICE"] || OPENAI_DEFAULT_VOICE,
      response_format: "mp3",
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`OpenAI TTS ${res.status}: ${body.slice(0, 300) || res.statusText}`)
  }
  return { audio: await res.arrayBuffer(), contentType: "audio/mpeg" }
}

export async function synthesizeSpeech(
  text: string,
  options?: Partial<TtsOptions>,
): Promise<TtsResult> {
  const cleanText = text.replace(/\s+/g, " ").trim()
  if (!cleanText) throw new Error("text field required")

  try {
    return await synthesizeOpenAI(cleanText)
  } catch (err) {
    console.warn(
      `[tts] OpenAI failed, falling back to ElevenLabs: ${err instanceof Error ? err.message : err}`,
    )
  }

  const voiceId = options?.voiceId || defaultVoiceId()
  const outputFormat = process.env["ELEVENLABS_OUTPUT_FORMAT"] || DEFAULT_OUTPUT_FORMAT
  const latency = process.env["ELEVENLABS_STREAMING_LATENCY"] ?? "0"
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}&optimize_streaming_latency=${latency}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: options?.modelId || process.env["ELEVENLABS_TTS_MODEL"] || DEFAULT_MODEL,
        voice_settings: options?.voiceSettings || defaultVoiceSettings(),
        apply_text_normalization: "auto",
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `ElevenLabs TTS failed (${res.status}): ${body.slice(0, 300) || res.statusText}`,
    )
  }

  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  }
}
