"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type RecorderState = "idle" | "recording" | "denied" | "unsupported"

const MAX_SECONDS = 120
const BARS = 28

// Browsers disagree on what they can record; take the first one this one supports.
function pickMimeType(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? ""
}

/** Record a voice note: live level bars for a waveform, a running timer, and a hard
 * stop at two minutes. ``stop`` resolves with the recording; ``cancel`` throws it away. */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle")
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0))
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const cleanup = useRef<() => void>(() => {})
  const done = useRef<((blob: Blob | null) => void) | null>(null)
  const startedAt = useRef(0)

  const teardown = useCallback(() => {
    cleanup.current()
    cleanup.current = () => {}
    recorder.current = null
    setLevels(Array(BARS).fill(0))
  }, [])

  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState("denied")
      return
    }
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = chunks.current.length
        ? new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" })
        : null
      done.current?.(blob)
      done.current = null
    }

    // Level meter for the waveform.
    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 256
    audio.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.frequencyBinCount)
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const elapsed = (now - startedAt.current) / 1000
      setSeconds(Math.floor(elapsed))
      if (elapsed >= MAX_SECONDS && rec.state === "recording") rec.stop()
      if (now - last < 33) return
      last = now
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const s of samples) peak = Math.max(peak, Math.abs(s - 128))
      setLevels((prev) => [...prev.slice(1), Math.min(1, peak / 64)])
    }

    cleanup.current = () => {
      cancelAnimationFrame(frame)
      stream.getTracks().forEach((t) => t.stop())
      void audio.close().catch(() => {})
    }
    recorder.current = rec
    startedAt.current = performance.now()
    setSeconds(0)
    rec.start(250)
    frame = requestAnimationFrame(tick)
    setState("recording")
  }, [])

  const stop = useCallback((): Promise<{ blob: Blob | null; seconds: number }> => {
    const rec = recorder.current
    const took = Math.max(1, Math.round((performance.now() - startedAt.current) / 1000))
    if (!rec || rec.state === "inactive") {
      teardown()
      setState("idle")
      return Promise.resolve({ blob: null, seconds: 0 })
    }
    return new Promise((resolve) => {
      done.current = (blob) => {
        teardown()
        setState("idle")
        resolve({ blob, seconds: took })
      }
      rec.stop()
    })
  }, [teardown])

  const cancel = useCallback(() => {
    const rec = recorder.current
    done.current = null
    if (rec && rec.state !== "inactive") rec.stop()
    teardown()
    setState("idle")
  }, [teardown])

  return { state, seconds, levels, start, stop, cancel }
}
