const DEFAULT_STT_MODEL = "scribe_v2"

export interface ElevenLabsSttResponse {
  text: string
}

function backendUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

export async function elevenLabsTranscribe(wav: Uint8Array): Promise<ElevenLabsSttResponse> {
  const form = new FormData()
  form.set("model_id", process.env["ELEVENLABS_STT_MODEL"] || DEFAULT_STT_MODEL)
  form.set("file", new Blob([wav], { type: "audio/wav" }), "audio.wav")

  const token = process.env["YOMI_SESSION_TOKEN"] ?? ""
  const secret = process.env["SIDECAR_SECRET"] ?? ""
  const headers: Record<string, string> = {}
  if (secret) headers["x-sidecar-secret"] = secret
  if (token) headers["Authorization"] = `Bearer ${token}`

  const response = await fetch(`${backendUrl()}/api/stt`, {
    method: "POST",
    headers,
    body: form,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`STT proxy failed (${response.status}): ${body || response.statusText}`)
  }

  const json = (await response.json()) as { text?: unknown }
  const text = typeof json.text === "string" ? json.text.trim() : ""
  if (!text) throw new Error("STT proxy returned no transcript")
  return { text }
}
