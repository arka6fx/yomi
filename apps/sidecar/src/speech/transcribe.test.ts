import { describe, it, expect, beforeEach, mock } from "bun:test"
import { transcribe, transcribeStreaming } from "./transcribe.js"

const DUMMY_WAV = new Uint8Array(44)

mock.module("openai", () => {
  return {
    default: class {
      audio = {
        transcriptions: {
          create: async () => ({ text: "transcribed text" }),
        },
      }
    },
  }
})

describe("transcribe", () => {
  it("returns transcribed text from OpenAI", async () => {
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
