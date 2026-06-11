import { describe, it, expect, mock } from "bun:test"
import { transcribe, transcribeStreaming } from "./transcribe.js"

const DUMMY_WAV = new Uint8Array(44)

mock.module("../services/bedrock/nova-sonic.js", () => ({
  novaSonicTranscribe: async () => ({ text: "transcribed text" }),
}))

describe("transcribe", () => {
  it("returns transcript from Nova Sonic", async () => {
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
