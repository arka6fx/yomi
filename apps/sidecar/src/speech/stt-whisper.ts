import { nodewhisper } from "nodejs-whisper"
import { writeFile, unlink } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { randomBytes } from "crypto"

// Configurable via WHISPER_MODEL env var. small.en (~244 MB) is a good default
// for accuracy; base.en (~75 MB) is faster but noticeably less accurate.
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "small.en"

// Writes to a temp file, runs whisper.cpp via subprocess, then cleans up.
export async function transcribeWhisper(wav: Uint8Array): Promise<string> {
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
