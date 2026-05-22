import { spawn } from "child_process"
import { readFile, unlink } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { randomBytes } from "crypto"

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

  // Write to temp file then read back — avoids /dev/stdout issues with mise-managed Python
  const tmp = join(tmpdir(), `yomi-tts-${randomBytes(4).toString("hex")}.mp3`)
  const proc = spawn(binary, [
    "--text", text,
    "--voice", voice,
    "--write-media", tmp,
  ], { stdio: ["ignore", "pipe", "pipe"] })

  const exitPromise = new Promise<number>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => resolve(code ?? 1))
  })

  try {
    const code = await exitPromise
    if (code !== 0) throw new Error(`edge-tts exited with code ${code}`)
    const buf = await readFile(tmp)
    if (buf.byteLength > 0) yield new Uint8Array(buf)
  } finally {
    if (!proc.killed) proc.kill()
    await unlink(tmp).catch(() => {})
  }
}
