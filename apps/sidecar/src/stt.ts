import { nodewhisper } from "nodejs-whisper"
import { writeFile, unlink } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { randomBytes } from "crypto"

// tiny.en: ~77 MB, downloaded once by nodejs-whisper on first use
const WHISPER_MODEL = "tiny.en"

export async function transcribe(wav: Uint8Array): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY
  if (key) {
    try {
      return await transcribeElevenLabs(wav, key)
    } catch (err) {
      console.warn("[yomi/stt] ElevenLabs failed, falling back to local Whisper:", err)
    }
  }
  return transcribeWhisper(wav)
}

async function transcribeElevenLabs(wav: Uint8Array, key: string): Promise<string> {
  const form = new FormData()
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "audio.wav")
  form.append("model_id", "scribe_v1")
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  })
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}`)
  return ((await res.json()) as { text: string }).text
}

// Writes to a temp file, runs whisper.cpp via subprocess, then cleans up.
async function transcribeWhisper(wav: Uint8Array): Promise<string> {
  const tmp = join(tmpdir(), `yomi-stt-${randomBytes(8).toString("hex")}.wav`)
  try {
    await writeFile(tmp, wav)
    const result = await nodewhisper(tmp, {
      modelName: WHISPER_MODEL,
      autoDownloadModelName: WHISPER_MODEL,
      whisperOptions: { outputInText: true },
    })
    return result.trim()
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
