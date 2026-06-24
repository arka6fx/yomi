const DEFAULT_TTS_MODEL = "eleven_flash_v2_5"
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"

function backendUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function voiceId(): string {
  return process.env["ELEVENLABS_VOICE_ID"] || DEFAULT_VOICE_ID
}

function voiceSettings() {
  return {
    stability: Number(process.env["ELEVENLABS_STABILITY"] ?? "0.45"),
    similarity_boost: Number(process.env["ELEVENLABS_SIMILARITY_BOOST"] ?? "0.85"),
    style: Number(process.env["ELEVENLABS_STYLE"] ?? "0.15"),
    use_speaker_boost: process.env["ELEVENLABS_SPEAKER_BOOST"] !== "0",
  }
}

export async function* elevenLabsSynthesize(text: string): AsyncGenerator<Uint8Array> {
  const token = process.env["YOMI_SESSION_TOKEN"] ?? ""
  const secret = process.env["SIDECAR_SECRET"] ?? ""
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["x-sidecar-secret"] = secret
  if (token) headers["Authorization"] = `Bearer ${token}`

  const response = await fetch(`${backendUrl()}/api/tts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      voice_id: voiceId(),
      model_id: process.env["ELEVENLABS_TTS_MODEL"] || DEFAULT_TTS_MODEL,
      voice_settings: voiceSettings(),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    if (response.status === 401) {
      throw new Error("TTS proxy unauthorized. Please sign in to Yomi again.")
    }
    throw new Error(`TTS proxy failed (${response.status}): ${body || response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("TTS proxy returned no audio stream")

  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    if (value?.byteLength) yield value
  }
}
