import OpenAI, { toFile } from "openai"

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export async function transcribe(wav: Uint8Array): Promise<string> {
  const model = process.env.STT_MODEL || "whisper-1"
  const transcript = await getOpenAI().audio.transcriptions.create({
    model,
    file: await toFile(wav, "audio.wav"),
  })
  return transcript.text
}

export async function* transcribeStreaming(wav: Uint8Array): AsyncGenerator<{ type: "final"; text: string }> {
  const text = await transcribe(wav)
  yield { type: "final", text }
}
