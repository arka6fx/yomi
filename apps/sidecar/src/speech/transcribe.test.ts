import { describe, it, expect, mock } from "bun:test"
import { transcribe, transcribeStreaming } from "./transcribe.js"

const DUMMY_WAV = new Uint8Array(44)

mock.module("../services/elevenlabs/stt.js", () => ({
  elevenLabsTranscribe: async () => ({ text: "transcribed text", language_code: "en" }),
}))

describe("transcribe", () => {
  it("returns transcript from ElevenLabs", async () => {
    const text = await transcribe(DUMMY_WAV)
    expect(text).toBe("transcribed text")
  })
})

describe("transcribeStreaming", () => {
  it("yields final chunk with transcription", async () => {
    const chunks = []
    for await (const c of transcribeStreaming(DUMMY_WAV)) chunks.push(c)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: "final", text: "transcribed text" })
  })
})
