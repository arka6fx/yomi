import React, { useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"
import { useYomiStore } from "./store"
import type { HotkeyState } from "./store"

// Animation keyframes for pulse (recording dot) and spin (thinking spinner)
const styleEl = document.createElement("style")
styleEl.textContent = `
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes spin  { to{transform:rotate(360deg)} }
  .drag { -webkit-app-region: drag; app-region: drag; }
  .no-drag { -webkit-app-region: no-drag; app-region: no-drag; }
`
document.head.appendChild(styleEl)

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

function StatusPill({ state }: { state: HotkeyState }) {
  const label = state === "listening" ? "Listening" : state === "processing" ? "Thinking…" : "Yomi"
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 20,
      background: "rgba(0,0,0,0.04)",
      border: "1px solid rgba(255,255,255,0.03)",
      color: "#fff", fontSize: 13, fontFamily: FONT,
      userSelect: "none", letterSpacing: "-0.01em",
      WebkitUserSelect: "none",
    }} className="drag">
      {state === "listening" && (
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: "#ef4444", animation: "pulse 1s ease-in-out infinite",
        }} />
      )}
      {state === "processing" && (
        <div style={{
          width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
          border: "2px solid rgba(255,255,255,0.2)",
          borderTopColor: "#fff", animation: "spin 0.7s linear infinite",
        }} />
      )}
      {state === "idle" && (
        <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: "rgba(255,255,255,0.35)" }} />
      )}
      <span>{label}</span>
    </div>
  )
}

function ResponseCard({
  text, error, onDismiss,
}: { text: string; error: string | null; onDismiss: () => void }) {
  return (
    <div style={{
      width: "100%", padding: 14, borderRadius: 12, boxSizing: "border-box",
      background: "rgba(0,0,0,0.06)",
      border: "1px solid rgba(255,255,255,0.03)",
      color: "#e0e0e0", fontSize: 14, fontFamily: FONT,
      lineHeight: 1.5, letterSpacing: "-0.01em",
      position: "relative", maxHeight: 120, overflowY: "auto",
    }} className="drag">
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute", top: 8, right: 10,
          background: "none", border: "none",
          color: "rgba(255,255,255,0.4)", cursor: "pointer",
          fontSize: 18, lineHeight: 1, padding: 2,
        }} className="no-drag">
        ×
      </button>
      {error
        ? <p style={{ margin: 0, paddingRight: 24, color: "#f87171" }}>⚠ {error}</p>
        : <p style={{ margin: 0, paddingRight: 24, whiteSpace: "pre-wrap" }}>{text}</p>
      }
    </div>
  )
}

const App: React.FC = () => {
  const { hotkeyState, entries, audioQueue, handleSseEvent, setHotkeyState, dismissEntry } = useYomiStore()

  const streamRef        = useRef<MediaStream | null>(null)
  const processorRef     = useRef<AudioWorkletNode | null>(null)
  const ctxRef           = useRef<AudioContext | null>(null)
  const workletReadyRef  = useRef<Promise<void> | null>(null)
  const audioPlayingRef  = useRef(false)
  const audioQueueRef    = useRef<string[]>([])
  const audioSourceRef   = useRef<AudioBufferSourceNode | null>(null)

  // Manual drag (Wayland-safe — CSS app-region unreliable)
  const draggingRef = useRef(false)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(".drag") || target.closest(".no-drag")) return
      draggingRef.current = true
      window.yomi.startDrag(e.screenX, e.screenY)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      window.yomi.moveDrag(e.screenX, e.screenY)
    }

    const onMouseUp = () => { draggingRef.current = false }

    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  // Wire IPC: SSE events and hotkey state from main process
  useEffect(() => {
    const cleanEvent = window.yomi.onEvent(handleSseEvent)
    const cleanState = window.yomi.onStateChange(setHotkeyState)
    return () => { cleanEvent(); cleanState() }
  }, [handleSseEvent, setHotkeyState])

  // Create AudioContext + load the PCM worklet processor once on mount.
  // Inline blob avoids needing a separate bundled worklet file in Vite.
  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    ctxRef.current = ctx

    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0] && inputs[0][0]
          if (input && input.length > 0) {
            // Copy: input buffer is reused on the next process() call
            const copy = new Float32Array(input)
            this.port.postMessage(copy.buffer, [copy.buffer])
          }
          return true
        }
      }
      registerProcessor('pcm-processor', PCMProcessor)
    `
    const blob = new Blob([workletCode], { type: "application/javascript" })
    const blobUrl = URL.createObjectURL(blob)
    workletReadyRef.current = ctx.audioWorklet
      .addModule(blobUrl)
      .finally(() => URL.revokeObjectURL(blobUrl))

    return () => {
      ctx.close().catch(() => {})
      ctxRef.current = null
      workletReadyRef.current = null
    }
  }, [])

  // Play audio chunks sequentially from the queue
  useEffect(() => {
    audioQueueRef.current = audioQueue
    if (audioQueue.length === 0 || audioPlayingRef.current) return
    const ctx = ctxRef.current
    if (!ctx) return

    audioPlayingRef.current = true
    const playNext = async () => {
      while (audioQueueRef.current.length > 0) {
        const base64 = audioQueueRef.current.shift()!
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        try {
          const audioBuf = await ctx.decodeAudioData(bytes.buffer)
          const src = ctx.createBufferSource()
          audioSourceRef.current = src
          src.buffer = audioBuf
          src.connect(ctx.destination)
          src.start()
          await new Promise<void>((r) => {
            src.onended = () => { if (audioSourceRef.current === src) audioSourceRef.current = null; r() }
          })
        } catch {
          // skip unplayable chunk
        }
      }
      audioPlayingRef.current = false
    }
    playNext()
  }, [audioQueue])

  // Acquire mic on mount — keep stream alive; only capture during listening
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => { streamRef.current = s })
      .catch(() => { /* denied — error surfaces on first hotkey press */ })
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  // Start/stop PCM streaming when hotkey state changes
  useEffect(() => {
    if (hotkeyState !== "listening") {
      processorRef.current?.disconnect()
      processorRef.current = null
      return
    }

    let cancelled = false
    let source: MediaStreamAudioSourceNode | null = null
    let processor: AudioWorkletNode | null = null

    ;(async () => {
      await workletReadyRef.current
      if (cancelled) return

      const stream = streamRef.current
      const ctx = ctxRef.current
      if (!stream || !ctx) return

      // Chrome autoplay policy: resume if suspended (hotkey counts as user gesture)
      if (ctx.state === "suspended") await ctx.resume()
      if (cancelled) return

      source = ctx.createMediaStreamSource(stream)
      processor = new AudioWorkletNode(ctx, "pcm-processor")
      processor.port.onmessage = (e) => {
        window.yomi.sendAudioChunk(e.data as ArrayBuffer, 16000)
      }
      source.connect(processor)
      // Processor must be connected for process() to run; outputs are silent.
      processor.connect(ctx.destination)
      processorRef.current = processor
    })()

    return () => {
      cancelled = true
      source?.disconnect()
      processor?.disconnect()
      processorRef.current = null
    }
  }, [hotkeyState])

  // Escape: stop audio and dismiss latest entry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      audioSourceRef.current?.stop()
      audioSourceRef.current = null
      audioPlayingRef.current = false
      audioQueueRef.current = []
      if (entries.length > 0) dismissEntry(entries[entries.length - 1]!.id)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [entries, dismissEntry])

  return (
    <>
      <div style={{
        position: "fixed", bottom: 16, right: 16, left: 16, top: 16,
        display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
        overflowY: "auto",
      }} className="drag">
        {entries.map((e) => (
          <ResponseCard key={e.id} text={e.text} error={e.error} onDismiss={() => dismissEntry(e.id)} />
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <StatusPill state={hotkeyState} />
        </div>
      </div>
      <div className="no-drag" style={{
        position: "fixed", bottom: 6, right: 6, display: "flex", gap: 4, zIndex: 999,
      }}>
        <button className="no-drag" onClick={() => window.yomi.resize(360, 150)} style={{
          background: "rgba(255,255,255,0.1)", border: "none",
          color: "rgba(255,255,255,0.5)", borderRadius: 4,
          cursor: "pointer", fontSize: 11, padding: "2px 6px",
        }}>S</button>
        <button className="no-drag" onClick={() => window.yomi.resize(480, 200)} style={{
          background: "rgba(255,255,255,0.1)", border: "none",
          color: "rgba(255,255,255,0.5)", borderRadius: 4,
          cursor: "pointer", fontSize: 11, padding: "2px 6px",
        }}>M</button>
        <button className="no-drag" onClick={() => window.yomi.resize(640, 300)} style={{
          background: "rgba(255,255,255,0.1)", border: "none",
          color: "rgba(255,255,255,0.5)", borderRadius: 4,
          cursor: "pointer", fontSize: 11, padding: "2px 6px",
        }}>L</button>
      </div>
    </>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
