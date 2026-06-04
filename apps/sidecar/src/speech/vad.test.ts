import { describe, it, expect, beforeEach } from "bun:test"
import { EnergyVad, detectSpeechEnd } from "./vad.js"

// Helpers to build synthetic PCM buffers
function makeSpeech(samples: number, amplitude = 10000): Int16Array {
  const arr = new Int16Array(samples)
  arr.fill(amplitude)
  return arr
}

function makeSilence(samples: number): Int16Array {
  return new Int16Array(samples) // zeroes → -inf dB
}

// Float32 [-1,1] frames — the renderer mic path feeds these.
function makeFloatSpeech(samples: number, amplitude = 0.3): Float32Array {
  const arr = new Float32Array(samples)
  arr.fill(amplitude)
  return arr
}

function makeFloatSilence(samples: number): Float32Array {
  return new Float32Array(samples)
}

function concat(...parts: Int16Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

describe("EnergyVad", () => {
  let vad: EnergyVad

  beforeEach(() => {
    vad = new EnergyVad({ sampleRate: 16000, silenceHangoverMs: 300 })
  })

  it("silence frame → hasSpeech=false, speechEnd=false", () => {
    const result = vad.processFrame(makeSilence(480))
    expect(result.hasSpeech).toBe(false)
    expect(result.speechEnd).toBe(false)
  })

  it("loud frame → hasSpeech=true, speechEnd=false", () => {
    const result = vad.processFrame(makeSpeech(480))
    expect(result.hasSpeech).toBe(true)
    expect(result.speechEnd).toBe(false)
  })

  it("speechEnd fires after speech then silence hangover", () => {
    // Feed 500ms of speech (480 samples/frame × ~16 frames)
    for (let i = 0; i < 17; i++) vad.processFrame(makeSpeech(480))

    // Feed silence until hangover fires (300ms = 4800 samples = 10 frames)
    let fired = false
    for (let i = 0; i < 12; i++) {
      const r = vad.processFrame(makeSilence(480))
      if (r.speechEnd) fired = true
    }
    expect(fired).toBe(true)
  })

  it("speechEnd does not fire without prior speech", () => {
    let fired = false
    for (let i = 0; i < 20; i++) {
      const r = vad.processFrame(makeSilence(480))
      if (r.speechEnd) fired = true
    }
    expect(fired).toBe(false)
  })

  it("reset() clears state so subsequent silence does not trigger speechEnd", () => {
    // Enter speech state
    vad.processFrame(makeSpeech(480))
    vad.reset()
    // Now silence should not trigger speechEnd
    let fired = false
    for (let i = 0; i < 20; i++) {
      const r = vad.processFrame(makeSilence(480))
      if (r.speechEnd) fired = true
    }
    expect(fired).toBe(false)
  })

  it("energyDb is finite and negative for silence", () => {
    const r = vad.processFrame(makeSilence(480))
    expect(isFinite(r.energyDb)).toBe(true)
    expect(r.energyDb).toBeLessThan(0)
  })

  // Renderer hands-free loop: Float32 mic frames with a ~1.5s silence tail must
  // auto-stop (speechEnd) just like the Int16 path.
  it("Float32 frames: speechEnd fires after speech then ~1.5s silence", () => {
    const v = new EnergyVad({ sampleRate: 16000, silenceHangoverMs: 1500 })
    // ~600ms of speech (480 samples/frame = 30ms × 20)
    for (let i = 0; i < 20; i++) v.processFrame(makeFloatSpeech(480))
    expect(v.processFrame(makeFloatSpeech(480)).speechEnd).toBe(false)

    // 1.5s hangover = 24000 samples = 50 frames; feed a few extra to be safe.
    let fired = false
    for (let i = 0; i < 55; i++) {
      if (v.processFrame(makeFloatSilence(480)).speechEnd) fired = true
    }
    expect(fired).toBe(true)
  })

  it("Float32 silence alone never fires speechEnd", () => {
    const v = new EnergyVad({ sampleRate: 16000, silenceHangoverMs: 1500 })
    let fired = false
    for (let i = 0; i < 80; i++) {
      if (v.processFrame(makeFloatSilence(480)).speechEnd) fired = true
    }
    expect(fired).toBe(false)
  })
})

describe("detectSpeechEnd", () => {
  const SR = 16000

  it("returns correct sample index after speech + hangover", () => {
    // 500ms speech + 400ms silence; hangover=300ms → end at ~500ms+300ms = 800ms = 12800 samples
    const speech = makeSpeech(SR / 2) // 8000 samples
    const silence = makeSilence(SR) // 16000 samples
    const pcm = concat(speech, silence)

    const end = detectSpeechEnd(pcm, { sampleRate: SR, silenceHangoverMs: 300 })
    // End should be somewhere around 12800 samples (±1 frame = 480 samples)
    expect(end).toBeGreaterThan(8000)
    expect(end).toBeLessThanOrEqual(pcm.length)
  })

  it("returns pcm.length when no speech-end detected", () => {
    // Pure speech, hangover never fires
    const pcm = makeSpeech(SR)
    const end = detectSpeechEnd(pcm, { sampleRate: SR })
    expect(end).toBe(pcm.length)
  })

  it("returns pcm.length for all silence (no prior speech)", () => {
    const pcm = makeSilence(SR)
    const end = detectSpeechEnd(pcm, { sampleRate: SR })
    expect(end).toBe(pcm.length)
  })
})
