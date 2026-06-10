"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  Link2,
  Loader2,
  Check,
  ArrowRight,
  AlertCircle,
  Clock,
  MessageCircle,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"

const PLATFORM_INFO: Record<string, { name: string; inviteUrl: string }> = {
  telegram: {
    name: "Telegram",
    inviteUrl: "https://t.me/yomi_assistant_bot",
  },
  discord: {
    name: "Discord",
    inviteUrl: `${BACKEND_URL}/api/gateway/discord/auth`,
  },
}

function LinkPageContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    platform?: string
    chatId?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!isPending && !session) router.push("/signin")
  }, [session, isPending, router])

  const [discordReady, setDiscordReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const codeParam = params.get("code")
    if (codeParam) {
      setCode(codeParam.toUpperCase().slice(0, 6))
    }
    if (params.get("discord_ready") === "true") {
      setDiscordReady(true)
    }
  }, [])

  async function handleLink() {
    if (!code || code.length < 6) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch(`${BACKEND_URL}/api/gateway/link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.session.token}`,
        },
        body: JSON.stringify({ code: code.toUpperCase() }),
      })
      const data = (await res.json()) as {
        ok: boolean
        platform?: string
        chatId?: string
        error?: string
      }
      setResult(data)
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      })
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setResult(null)
    setCode("")
  }

  if (isPending || !session) return null

  const platformInfo = result?.platform ? PLATFORM_INFO[result.platform] : null
  const inviteUrl =
    result?.platform === "discord" && result?.chatId
      ? `discord://-/channels/@me/${result.chatId}`
      : platformInfo?.inviteUrl
  const isExpired = result?.error?.toLowerCase().includes("expired")

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full blur-[160px]"
          style={{
            background:
              "radial-gradient(circle, rgba(14,165,233,0.06), transparent 65%)",
          }}
        />
      </div>

      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="font-display text-xl font-bold text-foreground select-none"
          >
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

      <main className="max-w-lg mx-auto px-6 py-20 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          {!result ? (
            <>
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-sky-500/10 mb-2">
                  <Link2 size={22} className="text-sky-400" />
                </div>
                <h1
                  className="text-2xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Link your account
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Enter the 6-character code shown in your messaging app to
                  connect it with Yomi.
                </p>
              </div>

              {discordReady && (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm space-y-2">
                  <p className="font-medium text-sky-300">Discord authorized!</p>
                  <ol className="text-xs text-sky-400/80 space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Join the <strong>Yomi Discord server</strong> below</li>
                    <li>Run <code className="bg-sky-500/20 px-1.5 py-0.5 rounded text-sky-300 font-mono text-[11px]">/link {code || "ABC123"}</code> in any channel</li>
                    <li>Your account will be linked instantly</li>
                  </ol>
                  <a
                    href={process.env.NEXT_PUBLIC_DISCORD_INVITE ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors bg-sky-500/10 rounded-lg px-3 py-1.5 mt-1"
                  >
                    <MessageCircle size={12} />
                    Join Yomi Discord Server
                  </a>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
                <div>
                  <label
                    htmlFor="code"
                    className="block text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2"
                  >
                    Linking code
                  </label>
                  <input
                    id="code"
                    type="text"
                    maxLength={6}
                    placeholder="ABC123"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.toUpperCase().slice(0, 6))
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleLink()}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-lg font-mono tracking-[0.3em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                    autoFocus
                  />
                </div>

                <button
                  onClick={handleLink}
                  disabled={loading || code.length < 6}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-4 py-3 text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowRight size={14} />
                  )}
                  Link account
                </button>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  How it works
                </p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li>Open the Yomi bot on Telegram or add it on Discord</li>
                  <li>The bot replies with a 6-character code</li>
                  <li>Enter that code above to link your account</li>
                  <li>Now you can talk to Yomi from anywhere!</li>
                </ol>

                <div className="flex flex-wrap gap-2 pt-1">
                  {Object.entries(PLATFORM_INFO).map(([key, info]) =>
                    info.inviteUrl ? (
                      <a
                        key={key}
                        href={info.inviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors bg-sky-500/10 rounded-lg px-3 py-1.5"
                      >
                        <MessageCircle size={12} />
                        {info.name}
                      </a>
                    ) : null,
                  )}

                </div>
              </div>
            </>
          ) : result.ok ? (
            <div className="text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10">
                <Check size={28} className="text-emerald-400" />
              </div>
              <div className="space-y-2">
                <h1
                  className="text-2xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Account linked!
                </h1>
                <p className="text-sm text-muted-foreground">
                  {platformInfo
                    ? `${platformInfo.name} is now connected. You can message Yomi from your ${platformInfo.name} app.`
                    : "Your account is now linked. You can message Yomi from your chat app."}
                </p>
              </div>
              <div className="flex items-center justify-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-6 py-3 text-sm hover:bg-primary/90 transition-colors"
                >
                  Go to Dashboard
                  <ArrowRight size={14} />
                </Link>
                {inviteUrl && platformInfo && (
                  <a
                    href={inviteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-card border border-border text-foreground rounded-xl font-medium px-6 py-3 text-sm hover:bg-muted transition-colors"
                  >
                    Open {platformInfo.name}
                    <MessageCircle size={14} />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10">
                {isExpired ? (
                  <Clock size={28} className="text-orange-400" />
                ) : (
                  <AlertCircle size={28} className="text-destructive" />
                )}
              </div>
              <div className="space-y-2">
                <h1
                  className="text-2xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  {isExpired ? "Code expired" : "Link failed"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {result.error || "Something went wrong. Please try again."}
                </p>
                {isExpired && (
                  <p className="text-xs text-muted-foreground">
                    Codes expire after 10 minutes. Message the bot again to get
                    a new one.
                  </p>
                )}
              </div>
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-6 py-3 text-sm hover:bg-primary/90 transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  )
}

export default function LinkPage() {
  return <LinkPageContent />
}
