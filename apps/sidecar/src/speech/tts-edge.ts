import { spawn } from "child_process"

// Microsoft edge-tts via the `edge-tts` Python CLI. Streams MP3 on stdout.
// No API key required; network access required.

const DEFAULT_VOICE = "en-US-AriaNeural"

export interface EdgeTtsOptions {
  voice?: string
  binary?: string
}

export async function* synthesizeEdgeTts(
  text: string,
  opts: EdgeTtsOptions = {},
): AsyncGenerator<Uint8Array> {
  const voice = opts.voice ?? process.env.EDGE_TTS_VOICE ?? DEFAULT_VOICE
  const binary = opts.binary ?? process.env.EDGE_TTS_BIN ?? "edge-tts"

  const proc = spawn(binary, [
    "--text", text,
    "--voice", voice,
    "--write-media", "/dev/stdout",
  ], { stdio: ["ignore", "pipe", "pipe"] })

  const errorPromise = new Promise<never>((_, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`edge-tts exited with code ${code}`))
    })
  })
  errorPromise.catch(() => { /* surfaced via the iterator below */ })

  try {
    for await (const chunk of proc.stdout) {
      const buf = chunk as Buffer
      if (buf.byteLength > 0) yield new Uint8Array(buf)
    }
  } finally {
    if (!proc.killed) proc.kill()
  }
}
