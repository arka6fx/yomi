// Preflight for the speech stack. Run with `bun run tts:check`.
// Validates the configured ElevenLabs voice synthesizes (catches the free-tier
// "library voice" 402), then optionally round-trips through a running sidecar.
const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://localhost:3002"
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL" // premade Sarah — usable on free tier

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function checkElevenLabs(): Promise<void> {
  const apiKey = requiredEnv("ELEVENLABS_API_KEY")
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID
  const model = process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5"
  const outputFormat = process.env.ELEVENLABS_TTS_OUTPUT_FORMAT?.trim() || "mp3_44100_128"

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`)
  url.searchParams.set("output_format", outputFormat)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text: "TTS check.", model_id: model }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    // Surface the most common misconfig explicitly.
    if (res.status === 402) {
      throw new Error(
        `ElevenLabs 402 for voice ${voiceId}: free-tier keys cannot use community "library" voices. ` +
          `Set ELEVENLABS_VOICE_ID to a premade voice (e.g. ${DEFAULT_VOICE_ID}). Raw: ${body}`,
      )
    }
    throw new Error(`ElevenLabs TTS ${res.status}: ${body}`)
  }

  const bytes = (await res.arrayBuffer()).byteLength
  console.log(`elevenlabs=status:${res.status} voice:${voiceId} model:${model} bytes:${bytes}`)
}

async function checkSidecar(): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (process.env.SIDECAR_SECRET?.trim())
    headers["x-sidecar-secret"] = process.env.SIDECAR_SECRET.trim()

  const res = await fetch(`${SIDECAR_URL}/query/fast`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: "Say hello in one short sentence.",
      tts: true,
      mode: "answer",
      plan: "max",
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Sidecar ${res.status}: ${body}`)
  }

  const text = await res.text()
  const audioChunks = [...text.matchAll(/"type":"audio_chunk"/g)].length
  const ttsErrors = [...text.matchAll(/"type":"tts_error"/g)].length
  const llmChunks = [...text.matchAll(/"type":"llm_chunk"/g)].length
  console.log(
    `sidecar=status:${res.status} llm_chunks:${llmChunks} audio_chunks:${audioChunks} tts_errors:${ttsErrors}`,
  )
}

try {
  await checkElevenLabs()
  try {
    await checkSidecar()
  } catch (err) {
    console.warn(`sidecar=skipped ${err instanceof Error ? err.message : String(err)}`)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
