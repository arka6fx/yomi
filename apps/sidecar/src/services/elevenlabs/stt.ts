const DEFAULT_STT_MODEL = "scribe_v2"

export interface ElevenLabsSttResponse {
  text: string
}

function apiKey(): string {
  const key = process.env["ELEVENLABS_API_KEY"]
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured")
  return key
}

export async function elevenLabsTranscribe(wav: Uint8Array): Promise<ElevenLabsSttResponse> {
  const form = new FormData()
  form.set("model_id", process.env["ELEVENLABS_STT_MODEL"] || DEFAULT_STT_MODEL)
  form.set("file", new Blob([wav], { type: "audio/wav" }), "audio.wav")

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
    },
    body: form,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`ElevenLabs STT failed (${response.status}): ${body || response.statusText}`)
  }

  const json = (await response.json()) as { text?: unknown }
  const text = typeof json.text === "string" ? json.text.trim() : ""
  if (!text) throw new Error("ElevenLabs STT returned no transcript")
  return { text }
}
