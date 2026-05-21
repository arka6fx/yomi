import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { SseEvent } from "@yomi/shared"
import { captureScreen } from "./capture"
import type { SidecarManager } from "./sidecar"
import { resetToIdle } from "./hotkey"

let pcmChunks: Float32Array[] = []
let capturedSampleRate = 16000

export function initIpc(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
): { onListenStop: () => Promise<void> } {
  // Renderer streams raw PCM Float32 chunks while in "listening" state
  ipcMain.on("yomi:audio-chunk", (_e, pcm: ArrayBuffer, sampleRate: number) => {
    pcmChunks.push(new Float32Array(pcm))
    capturedSampleRate = sampleRate
  })

  return {
    onListenStop: async () => {
      const chunks = pcmChunks.splice(0) // drain accumulator for this cycle
      try {
        const [wavBuffer, screenshotB64] = await Promise.all([
          Promise.resolve(buildWav(chunks, capturedSampleRate)),
          captureScreen(),
        ])
        const transcript = await transcribe(wavBuffer)
        await streamQuery(sidecar, overlayWin, transcript, screenshotB64)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        send(overlayWin, { type: "error", message })
        resetToIdle()
      }
    },
  }
}

function send(win: BrowserWindow, event: SseEvent): void {
  if (!win.isDestroyed()) win.webContents.send("yomi:event", event)
}

function buildWav(chunks: Float32Array[], sampleRate: number): Buffer {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const merged = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.length
  }

  // Float32 → Int16 PCM
  const int16 = new Int16Array(total)
  for (let i = 0; i < total; i++)
    int16[i] = Math.max(-32768, Math.min(32767, (merged[i]! * 32768) | 0))

  // 44-byte RIFF/WAV header
  const data = Buffer.from(int16.buffer)
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// ElevenLabs SDK v0.17 has no speechToText method — use raw fetch
async function transcribe(wav: Buffer): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error("ELEVENLABS_API_KEY not set — STT unavailable")
  const form = new FormData()
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav")
  form.append("model_id", "scribe_v1")
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  })
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}`)
  return ((await res.json()) as { text: string }).text
}

// EventSource is browser-only — use Node fetch + ReadableStream in main process
async function streamQuery(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
  text: string,
  screenshot_b64: string,
): Promise<void> {
  const res = await fetch(`${sidecar.baseUrl}/query/fast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sidecar-secret": sidecar.secret,
    },
    body: JSON.stringify({ text, screenshot_b64, mode: "answer" }),
  })
  if (!res.ok || !res.body) throw new Error(`Sidecar ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop()! // keep partial line for next iteration
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const event = JSON.parse(line.slice(6)) as SseEvent
      send(overlayWin, event)
      if (event.type === "done") {
        overlayWin.setIgnoreMouseEvents(false) // allow dismiss clicks on response
        resetToIdle()
      }
      if (event.type === "error") resetToIdle()
    }
  }
}
