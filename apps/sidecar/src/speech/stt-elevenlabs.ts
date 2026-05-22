// TODO: upgrade to ElevenLabsClient.speechToText.convertAsStream() once SDK exposes STT streaming.
// v0.17.x returns a single JSON object; we yield one final chunk to match the streaming interface.

export interface ElevenLabsChunk {
  type: "interim" | "final"
  text: string
}

export async function* transcribeElevenLabs(
  wav: Uint8Array,
  apiKey: string,
): AsyncGenerator<ElevenLabsChunk> {
  const form = new FormData()
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "audio.wav")
  form.append("model_id", "scribe_v1")
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}`)
  const text = ((await res.json()) as { text: string }).text
  yield { type: "final", text }
}

export async function transcribeElevenLabsFinal(
  wav: Uint8Array,
  apiKey: string,
): Promise<string> {
  for await (const chunk of transcribeElevenLabs(wav, apiKey)) {
    if (chunk.type === "final") return chunk.text
  }
  return ""
}
