// ElevenLabs scribe_v2 transcription — mirrors sidecar STT, no Bedrock.
// Used by the gateway to transcribe Telegram/Discord voice notes.

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text"
const MODEL = "scribe_v2"

function apiKey(): string {
  const k = process.env["ELEVENLABS_API_KEY"]
  if (!k) throw new Error("ELEVENLABS_API_KEY not set")
  return k
}

export async function transcribeBuffer(buf: ArrayBuffer, mimeType: string): Promise<string> {
  const key = apiKey()
  const form = new FormData()
  form.append("model_id", MODEL)
  form.append("file", new Blob([buf], { type: mimeType }), "audio")

  const res = await fetch(ELEVENLABS_URL, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  })

  if (res.status === 429) throw new Error("STT_RATE_LIMIT")
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ElevenLabs STT ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text?.trim() ?? ""
}

export async function transcribeAudioUrl(url: string, mimeType = "audio/ogg"): Promise<string> {
  const audioRes = await fetch(url)
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`)
  const buf = await audioRes.arrayBuffer()
  return transcribeBuffer(buf, mimeType)
}
