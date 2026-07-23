// STT: OpenAI transcription. Used by the gateway to transcribe Telegram voice notes.

function openaiKey(): string | null {
  return process.env["OPENAI_API_KEY"] || null
}

function openaiBase(): string {
  return (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(/\/+$/, "")
}

async function transcribeOpenAI(buf: ArrayBuffer, mimeType: string): Promise<string> {
  const key = openaiKey()
  if (!key) throw new Error("OpenAI key not set")
  const form = new FormData()
  form.append("model", process.env["OPENAI_STT_MODEL"] || "gpt-4o-mini-transcribe")
  form.append("file", new Blob([buf], { type: mimeType }), "audio")

  const res = await fetch(`${openaiBase()}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })

  if (res.status === 429) throw new Error("STT_RATE_LIMIT")
  if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { text?: string }
  return data.text?.trim() ?? ""
}

export async function transcribeBuffer(buf: ArrayBuffer, mimeType: string): Promise<string> {
  return transcribeOpenAI(buf, mimeType)
}

export async function transcribeAudioUrl(url: string, mimeType = "audio/ogg"): Promise<string> {
  const audioRes = await fetch(url)
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`)
  const buf = await audioRes.arrayBuffer()
  return transcribeBuffer(buf, mimeType)
}
