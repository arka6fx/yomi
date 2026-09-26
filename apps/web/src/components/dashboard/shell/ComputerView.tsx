"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ClipboardPaste, Loader2, Monitor, Save, Square } from "lucide-react"
import type RFB from "@novnc/novnc"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"

type Status = "idle" | "connecting" | "live" | "ended"

// Live view of the user's private computer: watch Yomi work, or take over to sign
// in, type an OTP or solve a captcha. Logins are saved when asked and before the
// computer sleeps, so the agent stays signed in next time.
export function ComputerView({ token }: { token: string }) {
  const screen = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const [paste, setPaste] = useState("")

  const auth = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    fetch("/api/computer", { headers: auth })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available: boolean }) => setAvailable(d.available))
      .catch(() => setAvailable(false))
  }, [token])

  const disconnect = useCallback(() => {
    rfb.current?.disconnect()
    rfb.current = null
  }, [])

  useEffect(() => disconnect, [disconnect])

  async function connect() {
    if (!screen.current) return
    setError("")
    setNotice("")
    setStatus("connecting")
    try {
      const res = await fetch("/api/computer/viewer", { method: "POST", headers: auth })
      const data = (await res.json().catch(() => ({}))) as { url?: string; detail?: string }
      if (!res.ok || !data.url) throw new Error(data.detail ?? "Couldn’t open your computer")
      // noVNC touches `window` on import, so load it only in the browser, on demand.
      const { default: RFBClient } = await import("@novnc/novnc")
      disconnect()
      screen.current.innerHTML = ""
      const client = new RFBClient(screen.current, data.url, { shared: true })
      client.scaleViewport = true
      client.resizeSession = false
      client.focusOnClick = true
      client.background = "transparent"
      client.addEventListener("connect", () => setStatus("live"))
      client.addEventListener("disconnect", () => {
        setStatus("ended")
        rfb.current = null
      })
      rfb.current = client
    } catch (err) {
      setStatus("idle")
      setError(err instanceof Error ? err.message : "Couldn’t open your computer")
    }
  }

  async function saveLogins() {
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const res = await fetch("/api/computer/save", { method: "POST", headers: auth })
      const data = (await res.json().catch(() => ({}))) as { saved?: boolean; detail?: string }
      if (!res.ok) throw new Error(data.detail ?? "Couldn’t save your logins")
      setNotice(
        data.saved
          ? "Saved. Yomi stays signed in to these sites next time."
          : "Nothing to save yet: open a site and sign in first.",
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save your logins")
    } finally {
      setSaving(false)
    }
  }

  const button =
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"

  return (
    <div className="space-y-6 pt-6">
      <PageHeader
        title="your computer"
        subtitle="yomi's private browser for shopping, food, rides and bookings. watch it work, or take over to sign in, type an OTP or solve a captcha."
      />

      {available === false && (
        <p className={cn(SURFACE, "p-5 text-sm text-muted-foreground")}>
          Your computer isn&apos;t available right now. Try again in a little while.
        </p>
      )}

      <div className={cn(SURFACE, "overflow-hidden p-0")}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span
              className={cn(
                "size-2 rounded-full",
                status === "live" ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {status === "live"
              ? "live: you can click and type"
              : status === "connecting"
                ? "waking your computer…"
                : status === "ended"
                  ? "disconnected"
                  : "not connected"}
          </div>
          <div className="flex flex-wrap gap-2">
            {status === "live" ? (
              <button onClick={disconnect} className={cn(button, "bg-muted")}>
                <Square size={13} /> stop watching
              </button>
            ) : (
              <button
                onClick={() => void connect()}
                disabled={!available || status === "connecting"}
                className={cn(button, "bg-foreground text-background")}
              >
                {status === "connecting" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Monitor size={14} />
                )}
                {status === "ended" ? "reconnect" : "open my computer"}
              </button>
            )}
            <button
              onClick={() => void saveLogins()}
              disabled={!available || saving}
              className={cn(button, "bg-muted")}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} save my
              logins
            </button>
          </div>
        </div>

        <div className="relative aspect-[16/10] w-full bg-black/90">
          <div ref={screen} className="absolute inset-0" />
          {status !== "live" && status !== "connecting" && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">
              <div>
                <Monitor size={28} className="mx-auto mb-3 text-white/50" />
                Open your computer to see it live. It wakes in a few seconds and sleeps after 5
                quiet minutes.
              </div>
            </div>
          )}
        </div>

        {status === "live" && (
          <form
            className="flex gap-2 border-t border-border px-5 py-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!paste) return
              rfb.current?.clipboardPasteFrom(paste)
              rfb.current?.focus()
              setPaste("")
            }}
          >
            <input
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="send text to the computer, then press Ctrl+V there (e.g. an OTP)"
              className="min-w-0 flex-1 rounded-full bg-muted px-4 py-2 text-sm outline-none"
            />
            <button type="submit" className={cn(button, "bg-muted")}>
              <ClipboardPaste size={14} /> send
            </button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-500">{notice}</p>}

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>• Sign in once to Amazon, Flipkart, Zomato and others; Yomi stays signed in.</li>
        <li>• Yomi asks before placing an order or paying.</li>
        <li>• Only you can open this view. Each link works for 10 minutes.</li>
      </ul>
    </div>
  )
}
