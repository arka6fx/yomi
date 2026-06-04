const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://localhost:3002"

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function checkSarvam(): Promise<void> {
  const apiKey = requiredEnv("SARVAM_API_KEY")
  const res = await fetch(SARVAM_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      inputs: ["TTS check."],
      target_language_code: "en-IN",
      speaker: process.env.SARVAM_VOICE ?? "shreya",
      model: "bulbul:v3",
      speech_sample_rate: 16000,
      pace: 1.0,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Sarvam TTS ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { audios?: string[] }
  const firstLen = data.audios?.[0]?.length ?? 0
  console.log(
    `sarvam=status:${res.status} audios:${data.audios?.length ?? 0} first_len:${firstLen}`,
  )
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
  await checkSarvam()
  try {
    await checkSidecar()
  } catch (err) {
    console.warn(`sidecar=skipped ${err instanceof Error ? err.message : String(err)}`)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
