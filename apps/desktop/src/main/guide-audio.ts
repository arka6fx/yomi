export const GUIDE_SPEECH_RMS = 0.006

export function audioRms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0
  let sum = 0
  for (const sample of chunk) sum += sample * sample
  return Math.sqrt(sum / chunk.length)
}

export function isGuideSpeechChunk(chunk: Float32Array, threshold = GUIDE_SPEECH_RMS): boolean {
  return audioRms(chunk) >= threshold
}
