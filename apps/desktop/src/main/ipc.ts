import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { SseEvent } from "@yomi/shared"
import { captureScreen } from "./capture"
import type { SidecarManager } from "./sidecar"
import { resetToIdle, activateProcessing } from "./hotkey"

let pcmChunks: Float32Array[] = []
let capturedSampleRate = 16000
let currentAbort: AbortController | null = null

// Abort any in-flight sidecar stream immediately.
export function abortCurrent(): void {
  currentAbort?.abort()
  currentAbort = null
}

// Registers sidecar-dependent IPC handlers. Called once after first auth.
export function initSidecarIpc(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
): { onListenStop: () => Promise<void>; onTextQuery: () => void; onAbort: () => void } {
  ipcMain.on("yomi:audio-chunk", (_e, pcm: ArrayBuffer, sampleRate: number) => {
    pcmChunks.push(new Float32Array(pcm))
    capturedSampleRate = sampleRate
  })

  // Text query: text-only output (no TTS)
  ipcMain.on("yomi:text-query", async (_e, text: string) => {
    if (!text?.trim()) { resetToIdle(); return }
    activateProcessing()
    try {
      const screenshotB64 = await captureScreen()
      await streamQuery(sidecar, overlayWin, text.trim(), screenshotB64, false)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      send(overlayWin, { type: "error", message: err instanceof Error ? err.message : "Unknown error" })
      resetToIdle()
    }
  })

  return {
    // Voice query: voice + text output (TTS enabled)
    onListenStop: async () => {
      const chunks = pcmChunks.splice(0)
      try {
        const wav = buildWav(chunks, capturedSampleRate)
        const [transcript, screenshotB64] = await Promise.all([
          transcribe(wav, sidecar),
          captureScreen(),
        ])
        await streamQuery(sidecar, overlayWin, transcript, screenshotB64, true)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        send(overlayWin, { type: "error", message: err instanceof Error ? err.message : "Unknown error" })
        resetToIdle()
      }
    },
    onTextQuery: () => { /* state managed by hotkey.ts transition */ },
    onAbort: abortCurrent,
  }
}

function send(win: BrowserWindow, event: SseEvent): void {
  if (!win.isDestroyed()) win.webContents.send("yomi:event", event)
}

function buildWav(chunks: Float32Array[], sampleRate: number): Buffer {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const merged = new Float32Array(total)
  let off = 0
  for (const c of chunks) { merged.set(c, off); off += c.length }

  const int16 = new Int16Array(total)
  for (let i = 0; i < total; i++)
    int16[i] = Math.max(-32768, Math.min(32767, (merged[i]! * 32768) | 0))

  const data = Buffer.from(int16.buffer)
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function transcribe(wav: Buffer, sidecar: SidecarManager): Promise<string> {
  const form = new FormData()
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav")
  const res = await fetch(`${sidecar.baseUrl}/stt`, {
    method: "POST",
    headers: { "x-sidecar-secret": sidecar.secret },
    body: form,
  })
  if (!res.ok) throw new Error(`Sidecar STT ${res.status}`)
  return ((await res.json()) as { text: string }).text
}

async function streamQuery(
  sidecar: SidecarManager,
  overlayWin: BrowserWindow,
  text: string,
  screenshot_b64: string,
  tts: boolean,
): Promise<void> {
  const abort = new AbortController()
  currentAbort = abort

  const res = await fetch(`${sidecar.baseUrl}/query/fast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sidecar-secret": sidecar.secret },
    body: JSON.stringify({ text, screenshot_b64, mode: "answer", tts }),
    signal: abort.signal,
  })
  if (!res.ok || !res.body) { currentAbort = null; throw new Error(`Sidecar ${res.status}`) }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let sawDone = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const event = JSON.parse(line.slice(6)) as SseEvent
        send(overlayWin, event)
        if (event.type === "done")  { sawDone = true; resetToIdle() }
        if (event.type === "error") { sawDone = true; resetToIdle() }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") { resetToIdle(); return }
    throw err
  } finally {
    currentAbort = null
  }

  if (!sawDone) resetToIdle()
}
