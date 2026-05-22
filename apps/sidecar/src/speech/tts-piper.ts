import { spawn } from "child_process"

// Piper offline TTS. Streams raw PCM (signed 16-bit, 22050 Hz mono by default
// for most lessac voices) on stdout. The caller is responsible for either
// playing PCM directly or wrapping in a WAV header before MP3 conversion.

const DEFAULT_VOICE = "en_US-lessac-medium"

export interface PiperOptions {
  voice?: string
  sentenceSilence?: number
  binary?: string
}

export async function* synthesizePiper(
  text: string,
  opts: PiperOptions = {},
): AsyncGenerator<Uint8Array> {
  const voice = opts.voice ?? process.env.PIPER_VOICE ?? DEFAULT_VOICE
  const binary = opts.binary ?? process.env.PIPER_BIN ?? "piper"
  const sentenceSilence = opts.sentenceSilence ?? 0.2

  const proc = spawn(binary, [
    "--model", voice,
    "--output-raw",
    "--sentence-silence", String(sentenceSilence),
  ], { stdio: ["pipe", "pipe", "pipe"] })

  // Surface spawn errors (e.g. ENOENT when piper isn't installed).
  const errorPromise = new Promise<never>((_, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`piper exited with code ${code}`))
    })
  })
  errorPromise.catch(() => { /* surfaced via the iterator below */ })

  proc.stdin.write(text + "\n")
  proc.stdin.end()

  try {
    for await (const chunk of proc.stdout) {
      const buf = chunk as Buffer
      if (buf.byteLength > 0) yield new Uint8Array(buf)
    }
  } finally {
    if (!proc.killed) proc.kill()
  }
}
