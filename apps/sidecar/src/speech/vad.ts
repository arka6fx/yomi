// Upgrade path: replace EnergyVad.processFrame with @ricky0123/vad-node Silero VAD
// via ort.InferenceSession; VadResult interface stays the same.

export interface VadResult {
  hasSpeech: boolean
  speechEnd: boolean  // true when silence hangover fires after speech
  energyDb: number
}

export interface VadOptions {
  sampleRate?: number          // default 16000
  frameSizeMs?: number         // default 30 (480 samples at 16kHz)
  speechThresholdDb?: number   // default -35 dB
  silenceThresholdDb?: number  // default -45 dB
  silenceHangoverMs?: number   // default 300 ms
}

export class EnergyVad {
  private readonly sampleRate: number
  private readonly speechThresh: number
  private readonly silenceThresh: number
  private readonly hangoverSamples: number

  private inSpeech = false
  private silenceSamples = 0

  constructor(opts: VadOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 16000
    this.speechThresh = opts.speechThresholdDb ?? -35
    this.silenceThresh = opts.silenceThresholdDb ?? -45
    this.hangoverSamples = Math.round((opts.silenceHangoverMs ?? 300) * this.sampleRate / 1000)
  }

  processFrame(samples: Int16Array): VadResult {
    // RMS → dB
    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) * (samples[i] ?? 0)
    const rms = Math.sqrt(sum / (samples.length || 1))
    const energyDb = 20 * Math.log10(rms + 1e-10)

    let hasSpeech = false
    let speechEnd = false

    if (energyDb >= this.speechThresh) {
      hasSpeech = true
      this.inSpeech = true
      this.silenceSamples = 0
    } else if (energyDb < this.silenceThresh) {
      if (this.inSpeech) {
        this.silenceSamples += samples.length
        if (this.silenceSamples >= this.hangoverSamples) {
          speechEnd = true
          this.inSpeech = false
          this.silenceSamples = 0
        }
      }
    }

    return { hasSpeech, speechEnd, energyDb }
  }

  reset(): void {
    this.inSpeech = false
    this.silenceSamples = 0
  }
}

// Returns sample index where speech ends; returns pcm.length if speech never ended.
export function detectSpeechEnd(pcm: Int16Array, opts?: VadOptions): number {
  const vad = new EnergyVad(opts)
  const frameSize = Math.round(((opts?.frameSizeMs ?? 30) * (opts?.sampleRate ?? 16000)) / 1000)
  let offset = 0
  while (offset + frameSize <= pcm.length) {
    const frame = pcm.subarray(offset, offset + frameSize)
    const result = vad.processFrame(frame)
    if (result.speechEnd) return offset + frameSize
    offset += frameSize
  }
  return pcm.length
}
