"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Loader2, Check, MonitorSmartphone } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import Link from "next/link"

function DeviceContent() {
  const router = useRouter()

  const { data: session, isPending } = authClient.useSession()
  const [urlCode, setUrlCode] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const confirmedRef = useRef(false)

  function friendlyDeviceError(raw: string): string {
    switch (raw) {
      case "invalid_user_code":
        return "That code is not active. Restart sign-in from the desktop app and use the new code."
      case "expired_user_code":
        return "That code expired. Restart sign-in from the desktop app to get a fresh code."
      case "Not authenticated":
        return "Sign in first, then connect the desktop app."
      case "Backend unreachable":
        return "Cannot reach the Yomi backend. Check that the backend and landing app use the same environment."
      default:
        return raw || "Failed to connect the desktop app."
    }
  }

  async function confirmCode(codeToConfirm: string, token: string) {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/device-code/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_code: codeToConfirm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to confirm device")
      setDone(true)
    } catch (err) {
      setError(friendlyDeviceError(err instanceof Error ? err.message : "Something went wrong"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const codeParam =
      new URLSearchParams(window.location.search).get("code")?.trim().toUpperCase() ?? null
    setUrlCode(codeParam)
    if (codeParam) setCode(codeParam)
  }, [])

  // Auto-confirm when user arrives with code in URL and is already logged in
  useEffect(() => {
    if (!session || !urlCode || done || confirmedRef.current) return
    confirmedRef.current = true
    setCode(urlCode)
    confirmCode(urlCode, session.session.token)
  }, [session, urlCode, done])

  // Not logged in + code in URL → send to sign-in, preserving the code in redirect
  useEffect(() => {
    if (isPending || session || !urlCode) return
    router.replace(`/signin?redirect=${encodeURIComponent(`/device?code=${urlCode}`)}`)
  }, [isPending, session, urlCode, router])

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    await confirmCode(trimmed, session.session.token)
  }

  // Full-screen loader while session loads (avoids flicker when auto-confirming)
  if (isPending) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    )
  }

  // Redirecting to sign-in (or still loading) — show spinner
  if (!session && urlCode) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative z-10 w-full max-w-sm"
    >
      {/* Logo */}
      <Link
        href="/"
        className="font-display text-2xl font-bold text-foreground block text-center mb-10 select-none"
      >
        Yomi
      </Link>

      <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
        {done ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <div className="rounded-full bg-emerald-500/10 p-4">
              <Check className="text-emerald-400" size={24} />
            </div>
            <div>
              <h1 className="text-lg font-medium text-foreground">You&apos;re connected</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your desktop app is now signed in. You can close this tab.
              </p>
            </div>
          </div>
        ) : loading && urlCode ? (
          /* Auto-confirming spinner */
          <div className="flex flex-col items-center gap-4 text-center py-8">
            <Loader2 className="animate-spin text-primary" size={24} />
            <p className="text-sm text-muted-foreground">Connecting your desktop app…</p>
          </div>
        ) : !session ? (
          /* Logged-out, no code in URL */
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <div className="rounded-full bg-primary/10 p-4">
              <MonitorSmartphone className="text-primary" size={24} />
            </div>
            <div>
              <h1 className="text-lg font-medium text-foreground">Sign in to connect</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Sign in to your Yomi account first, then come back here to enter your device code.
              </p>
            </div>
            <Link
              href="/signin?redirect=/device"
              className="w-full bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-medium text-center hover:bg-primary/90 transition-colors"
            >
              Sign in
            </Link>
          </div>
        ) : (
          /* Logged-in manual entry */
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <MonitorSmartphone className="text-primary" size={24} />
              </div>
              <div>
                <h1 className="text-lg font-medium text-foreground">Connect Yomi Desktop</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter the code shown in the desktop app window.
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirm} className="space-y-3">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCDEF"
                maxLength={8}
                autoFocus
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-2xl font-mono font-bold tracking-[0.2em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 uppercase"
              />
              {error && <p className="text-xs text-destructive text-center leading-5">{error}</p>}
              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
              </button>
            </form>

            <p className="text-xs text-muted-foreground text-center">
              Signed in as <span className="text-foreground">{session.user.email}</span>
            </p>
          </>
        )}
      </div>
    </motion.div>
  )
}

export default function DevicePage() {
  return (
    <main className="min-h-dvh bg-background flex flex-col items-center justify-center px-6">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 800px 600px at 50% 30%, rgba(255,224,194,0.07) 0%, transparent 70%)",
        }}
      />
      <DeviceContent />
    </main>
  )
}
