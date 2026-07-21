"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Check, Loader2, MessageCircle } from "lucide-react"
import { authClient } from "@/lib/auth-client"

type PlatformLink = { platform: string }

const POLL_INTERVAL_MS = 2_000
const POLL_TIMEOUT_MS = 90_000

function LinkPageContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [waitingForTelegram, setWaitingForTelegram] = useState(false)
  const [deepLink, setDeepLink] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isPending && !session) router.push("/signin")
  }, [session, isPending, router])

  useEffect(() => {
    if (!session) return
    void checkTelegramLinked()
      .then(setConnected)
      .catch(() => {})
  }, [session])

  useEffect(() => {
    if (!session || connected) return
    void fetchDeepLink()
      .then(setDeepLink)
      .catch(() => {
        // best-effort — handleConnect's fallback path re-fetches on click
      })
  }, [session, connected])

  async function checkTelegramLinked() {
    const res = await fetch("/api/gateway/connections", {
      headers: { Authorization: `Bearer ${session!.session.token}` },
    })
    if (!res.ok) return false
    const links = (await res.json()) as PlatformLink[]
    return links.some((link) => link.platform === "telegram")
  }

  async function waitForTelegramLink() {
    const startedAt = Date.now()
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      if (await checkTelegramLinked()) {
        setConnected(true)
        setWaitingForTelegram(false)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    setWaitingForTelegram(false)
  }

  async function fetchDeepLink(): Promise<string> {
    const res = await fetch(`/api/gateway/telegram/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session!.session.token}`,
      },
    })
    const data = (await res.json()) as { deepLink?: string; error?: string }
    if (!res.ok || !data.deepLink) throw new Error(data.error ?? "Failed to connect")
    return data.deepLink
  }

  async function handleConnect() {
    setConnecting(true)
    setError("")

    // Fast path: the mount-time effect already has a live token. A plain
    // window.open with a real URL, called synchronously inside this click
    // handler, is popup-blocker-safe — no about:blank trick needed.
    if (deepLink) {
      window.open(deepLink, "_blank")
      setWaitingForTelegram(true)
      setConnecting(false)
      void waitForTelegramLink()
      return
    }

    // Fallback: mount-time fetch hasn't resolved yet (or failed). Keep the
    // about:blank-then-redirect trick here, since this path awaits a fetch
    // before it has anywhere to send the popup.
    const telegramWindow = window.open("about:blank", "_blank")
    if (telegramWindow) telegramWindow.opener = null
    try {
      const link = await fetchDeepLink()
      setDeepLink(link)
      setWaitingForTelegram(true)
      if (telegramWindow) {
        telegramWindow.location.href = link
      } else {
        window.location.href = link
      }
      void waitForTelegramLink()
    } catch (err) {
      telegramWindow?.close()
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setWaitingForTelegram(false)
    } finally {
      setConnecting(false)
    }
  }

  if (isPending || !session) return null

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full blur-[160px]"
          style={{ background: "radial-gradient(circle, rgba(14,165,233,0.06), transparent 65%)" }}
        />
      </div>

      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-bold text-foreground select-none">
            Yomi
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {session.user.email}
            </span>
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-sm mx-auto px-6 py-24 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8 text-center"
        >
          {connected ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10">
                <Check size={28} className="text-emerald-400" />
              </div>
              <div className="space-y-2">
                <h1
                  className="text-2xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Telegram linked
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  You can message Yomi from Telegram now. Try{" "}
                  <strong className="text-foreground">/help</strong> or ask a question.
                </p>
              </div>
              <div className="flex flex-col items-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-6 py-3 text-sm hover:bg-primary/90 transition-colors"
                >
                  Go to Dashboard
                  <ArrowRight size={14} />
                </Link>
                <button
                  onClick={handleConnect}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Open Telegram again
                </button>
              </div>
            </>
          ) : waitingForTelegram ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sky-500/10">
                <Loader2 size={28} className="text-sky-400 animate-spin" />
              </div>
              <div className="space-y-2">
                <h1
                  className="text-2xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Waiting for Start
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Telegram is open. Press <strong className="text-foreground">Start</strong> in the
                  Yomi bot chat and this page will confirm automatically.
                </p>
              </div>
              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.04] p-4 text-left">
                <p className="text-xs uppercase tracking-widest text-sky-300 mb-2">Secure link</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This link expires soon and only connects this Telegram account to{" "}
                  <span className="text-foreground">{session.user.email}</span>.
                </p>
              </div>
              <div className="flex flex-col items-center gap-3">
                {deepLink && (
                  <a
                    href={deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-6 py-3 text-sm hover:bg-primary/90 transition-colors"
                  >
                    Open Telegram again
                    <ArrowRight size={14} />
                  </a>
                )}
                <button
                  onClick={() =>
                    void checkTelegramLinked().then((ok) => {
                      if (ok) setConnected(true)
                      else setError("Not linked yet. Press Start in Telegram first.")
                    })
                  }
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  I pressed Start
                </button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sky-500/10">
                <MessageCircle size={28} className="text-sky-400" />
              </div>
              <div className="space-y-2">
                <h1
                  className="text-2xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Connect Telegram
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Chat with Yomi from your phone, even when your laptop is closed.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-card/70 p-4 text-left shadow-sm">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                  How it works
                </p>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-xs text-sky-300">
                      1
                    </span>
                    <span>Open Telegram from this page.</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-xs text-sky-300">
                      2
                    </span>
                    <span>
                      Press <strong className="text-foreground">Start</strong> in the bot chat.
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-xs text-sky-300">
                      3
                    </span>
                    <span>This page confirms when the account is linked.</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-medium px-4 py-3.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <MessageCircle size={15} />
                )}
                {connecting ? "Opening Telegram…" : "Connect Telegram"}
              </button>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <p className="text-xs text-muted-foreground leading-relaxed">
                Use this button instead of searching for the bot manually. It includes a private
                one-time link token.
              </p>
            </>
          )}
        </motion.div>
      </main>
    </div>
  )
}

export default function LinkPage() {
  return <LinkPageContent />
}
