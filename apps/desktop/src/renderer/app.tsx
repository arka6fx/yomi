import React, { useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"
import { useYomiStore } from "./store"
import type { HotkeyState } from "./store"

// Animation keyframes for pulse (recording dot) and spin (thinking spinner)
const styleEl = document.createElement("style")
styleEl.textContent = `
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes spin  { to{transform:rotate(360deg)} }
`
document.head.appendChild(styleEl)

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

function StatusPill({ state }: { state: HotkeyState }) {
  const label = state === "listening" ? "Listening" : state === "processing" ? "Thinking…" : "Yomi"
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 20,
      background: "rgba(10,10,10,0.82)",
      border: "1px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(12px)",
      color: "#fff", fontSize: 13, fontFamily: FONT,
      userSelect: "none", letterSpacing: "-0.01em",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      WebkitUserSelect: "none",
    }}>
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
      background: "rgba(10,10,10,0.88)",
      border: "1px solid rgba(255,255,255,0.1)",
      backdropFilter: "blur(16px)",
      color: "#f0f0f0", fontSize: 14, fontFamily: FONT,
      lineHeight: 1.5, letterSpacing: "-0.01em",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      position: "relative", maxHeight: 120, overflowY: "auto",
    }}>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute", top: 8, right: 10,
          background: "none", border: "none",
          color: "rgba(255,255,255,0.4)", cursor: "pointer",
          fontSize: 18, lineHeight: 1, padding: 2,
        }}
      >×</button>
      {error
        ? <p style={{ margin: 0, paddingRight: 24, color: "#f87171" }}>⚠ {error}</p>
        : <p style={{ margin: 0, paddingRight: 24, whiteSpace: "pre-wrap" }}>{text}</p>
      }
    </div>
  )
}

const App: React.FC = () => {
  const { hotkeyState, responseText, error, handleSseEvent, setHotkeyState, reset } = useYomiStore()

  const streamRef    = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const ctxRef       = useRef<AudioContext | null>(null)

  // Wire IPC: SSE events and hotkey state from main process
  useEffect(() => {
    const cleanEvent = window.yomi.onEvent(handleSseEvent)
    const cleanState = window.yomi.onStateChange(setHotkeyState)
    return () => { cleanEvent(); cleanState() }
  }, [handleSseEvent, setHotkeyState])

  // Acquire mic on mount — keep stream alive; only capture during listening
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => { streamRef.current = s })
      .catch(() => { /* denied — error surfaces on first hotkey press */ })
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  // Start/stop PCM streaming when hotkey state changes
  useEffect(() => {
    if (hotkeyState === "listening") {
      const stream = streamRef.current
      if (!stream) return
      const ctx = new AudioContext({ sampleRate: 16000 })
      ctxRef.current = ctx
      const source    = ctx.createMediaStreamSource(stream)
      // ScriptProcessorNode is deprecated but universally supported without AudioWorklet complexity
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e) => {
        const pcm = e.inputBuffer.getChannelData(0)
        window.yomi.sendAudioChunk(pcm.buffer.slice(0) as ArrayBuffer, 16000)
      }
      source.connect(processor)
      processor.connect(ctx.destination)
      processorRef.current = processor
    } else {
      processorRef.current?.disconnect()
      ctxRef.current?.close()
      processorRef.current = null
      ctxRef.current       = null
    }
  }, [hotkeyState])

  // Auto-dismiss response 8s after pipeline completes
  useEffect(() => {
    if (hotkeyState === "idle" && (responseText || error)) {
      const t = setTimeout(reset, 8_000)
      return () => clearTimeout(t)
    }
  }, [hotkeyState, responseText, error, reset])

  const showResponse = !!(responseText || error)

  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, left: 16,
      display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
    }}>
      {showResponse && (
        <ResponseCard text={responseText} error={error} onDismiss={reset} />
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <StatusPill state={hotkeyState} />
      </div>
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
