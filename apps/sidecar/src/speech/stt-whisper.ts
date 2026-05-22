import { nodewhisper } from "nodejs-whisper"
import { writeFile, unlink } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { randomBytes } from "crypto"

// base.en: ~75 MB, downloaded once by nodejs-whisper on first use
const WHISPER_MODEL = "base.en"

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
