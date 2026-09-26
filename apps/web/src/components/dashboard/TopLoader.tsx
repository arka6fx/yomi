"use client"

import { useEffect, useState } from "react"

// A thin progress bar across the top of the page while the dashboard waits on the
// network. It follows every in-flight fetch, so the first load, switching to a tab
// that loads its data, and saving all show it without each view wiring it up.

const SHOW_AFTER_MS = 200 // fast requests (and background refreshes) never flash it

type Listener = (pending: number) => void
const listeners = new Set<Listener>()
let pending = 0
let patched = false

function emit() {
  for (const listener of listeners) listener(pending)
}

// Wrap fetch once, as early as the module loads in the browser, so requests made by
// components that mount before this one are counted too.
function patchFetch() {
  if (patched || typeof window === "undefined") return
  patched = true
  const original = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    pending += 1
    emit()
    try {
      return await original(...args)
    } finally {
      pending -= 1
      emit()
    }
  }
}

patchFetch()

export function TopLoader() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined
    const onChange = (count: number) => {
      if (count > 0) {
        showTimer ??= setTimeout(() => setBusy(true), SHOW_AFTER_MS)
      } else {
        clearTimeout(showTimer)
        showTimer = undefined
        setBusy(false)
      }
    }
    listeners.add(onChange)
    onChange(pending)
    return () => {
      listeners.delete(onChange)
      clearTimeout(showTimer)
    }
  }, [])

  // While busy, creep toward 90% in shrinking steps; when done, fill and fade out.
  useEffect(() => {
    if (busy) {
      setVisible(true)
      // A new wave of requests right after one finished continues from near the end
      // instead of jumping back to the start.
      setProgress((p) => (p >= 90 ? 80 : p > 0 ? p : 12))
      const trickle = setInterval(() => setProgress((p) => p + (90 - p) * 0.12), 250)
      return () => clearInterval(trickle)
    }
    if (!visible) return
    setProgress(100)
    const hide = setTimeout(() => {
      setVisible(false)
      setProgress(0)
    }, 350)
    return () => clearTimeout(hide)
  }, [busy, visible])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 300ms ease" }}
    >
      <div
        className="h-full rounded-r-full bg-gradient-to-r from-[#37aee2] to-[#1e96c8] shadow-[0_0_10px_rgba(34,158,217,0.7)]"
        style={{
          width: `${progress}%`,
          transition: progress === 0 ? "none" : "width 250ms ease-out",
        }}
      />
    </div>
  )
}
