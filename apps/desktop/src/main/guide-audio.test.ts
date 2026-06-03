import { describe, expect, it } from "bun:test"
import { audioRms, GUIDE_SPEECH_RMS, isGuideSpeechChunk } from "./guide-audio"

describe("guide audio detection", () => {
  it("treats empty chunks as silence", () => {
    expect(audioRms(new Float32Array())).toBe(0)
    expect(isGuideSpeechChunk(new Float32Array())).toBe(false)
  })

  it("keeps quiet input below the guide speech threshold", () => {
    const quiet = new Float32Array([0.002, -0.003, 0.001, -0.002])
    expect(audioRms(quiet)).toBeLessThan(GUIDE_SPEECH_RMS)
    expect(isGuideSpeechChunk(quiet)).toBe(false)
  })

  it("detects sustained voice-level input above the guide speech threshold", () => {
    const voice = new Float32Array([0.03, -0.025, 0.022, -0.027])
    expect(audioRms(voice)).toBeGreaterThanOrEqual(GUIDE_SPEECH_RMS)
    expect(isGuideSpeechChunk(voice)).toBe(true)
  })
})
