"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Check, Loader2, MessageCircle } from "lucide-react"
import { authClient } from "@/lib/auth-client"

function LinkPageContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isPending && !session) router.push("/signin")
  }, [session, isPending, router])

  async function handleConnect() {
    setConnecting(true)
    setError("")
    try {
      const res = await fetch(`/api/gateway/telegram/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.session.token}`,
        },
      })
      const data = (await res.json()) as { deepLink?: string; error?: string }
      if (!res.ok || !data.deepLink) throw new Error(data.error ?? "Failed to connect")
      window.open(data.deepLink, "_blank")
      setConnected(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
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
                <h1 className="text-2xl font-light text-foreground" style={{ letterSpacing: "-0.03em" }}>
                  Telegram opened
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Press <strong className="text-foreground">Start</strong> in the Yomi bot chat to finish linking your account.
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
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sky-500/10">
                <MessageCircle size={28} className="text-sky-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-light text-foreground" style={{ letterSpacing: "-0.03em" }}>
                  Connect Telegram
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Chat with Yomi from your phone, even when your laptop is closed.
                </p>
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

              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}

              <p className="text-xs text-muted-foreground leading-relaxed">
                Telegram will open with the Yomi bot. Press <strong className="text-foreground">Start</strong> and you're linked.
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
