import { whisperMock } from "./__test-mocks.js"
import { describe, it, expect, beforeEach } from "bun:test"
import { transcribeWhisper } from "./stt-whisper.js"

const DUMMY_WAV = new Uint8Array(44)

beforeEach(() => {
  whisperMock.reset()
  whisperMock.result = "  whisper result  "
})

describe("transcribeWhisper", () => {
  it("returns trimmed transcript", async () => {
    const text = await transcribeWhisper(DUMMY_WAV)
    expect(text).toBe("whisper result")
  })

  it("uses base.en model", async () => {
    await transcribeWhisper(DUMMY_WAV)
    const opts = whisperMock.lastOpts as any
    expect(opts.modelName).toBe("base.en")
    expect(opts.autoDownloadModelName).toBe("base.en")
  })

  it("writes WAV to a temp file", async () => {
    await transcribeWhisper(DUMMY_WAV)
    expect(whisperMock.writeFilePath).toMatch(/yomi-stt-.+\.wav$/)
  })

  it("calls unlink even when nodewhisper succeeds", async () => {
    await transcribeWhisper(DUMMY_WAV)
    expect(whisperMock.unlinkCalled).toBe(true)
  })
})
