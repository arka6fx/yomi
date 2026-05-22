import { spawn } from "child_process"

const DEFAULT_VOICE = "en_US-lessac-medium"

export interface PiperOptions {
  voice?: string
  sentenceSilence?: number
  binary?: string
}

function buildWavHeader(sampleRate: number, bitsPerSample: number, channels: number, dataLength: number): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const totalDataLen = dataLength + 36

  header.write("RIFF", 0)
  header.writeUInt32LE(totalDataLen, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataLength, 40)
  return header
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
  ], { stdio: ["pipe", "pipe", "pipe"], shell: true })

  const errorPromise = new Promise<never>((_, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`piper exited with code ${code}`))
    })
  })
  errorPromise.catch(() => {})

  proc.stdin.write(text + "\n")
  proc.stdin.end()

  const pcmChunks: Buffer[] = []
  try {
    for await (const chunk of proc.stdout) {
      const buf = chunk as Buffer
      if (buf.byteLength > 0) pcmChunks.push(buf)
    }
  } finally {
    if (!proc.killed) proc.kill()
  }

  if (pcmChunks.length > 0) {
    const pcmData = Buffer.concat(pcmChunks)
    const header = buildWavHeader(22050, 16, 1, pcmData.length)
    yield new Uint8Array(Buffer.concat([header, pcmData]))
  }
}
