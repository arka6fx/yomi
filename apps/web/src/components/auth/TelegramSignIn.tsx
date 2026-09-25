"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { TelegramIcon } from "@/components/TelegramIcon"

type Login = { token: string; code: string; url: string; expiresAt: string }
type Phase = "idle" | "starting" | "waiting" | "done" | "expired" | "cancelled"

const POLL_MS = 2000

function redirectTarget(): string {
  const params = new URLSearchParams(window.location.search)
  const target = params.get("redirect") ?? "/dashboard"
  // Only same-site paths; never bounce a fresh session to another origin.
  return target.startsWith("/") && !target.startsWith("//") ? target : "/dashboard"
}

export function TelegramSignIn({ mode }: { mode: "signin" | "signup" }) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [login, setLogin] = useState<Login | null>(null)
  const [error, setError] = useState("")
  const [oauth, setOauth] = useState<"google" | "github" | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  const poll = useCallback((token: string) => {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth/telegram-login/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        })
        const { status } = (await res.json()) as { status: string }
        if (status === "approved") {
          setPhase("done")
          window.location.assign(redirectTarget())
          return
        }
        if (status === "expired" || status === "consumed" || status === "unknown") {
          setPhase("expired")
          return
        }
        if (status === "cancelled") {
          setPhase("cancelled")
          return
        }
      } catch {
        // transient network blip: keep waiting
      }
      poll(token)
    }, POLL_MS)
  }, [])

  async function start() {
    stop()
    setError("")
    setPhase("starting")
    try {
      const res = await fetch("/api/auth/telegram-login/start", { method: "POST" })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as Login
      setLogin(data)
      setPhase("waiting")
      window.open(data.url, "_blank", "noopener")
      poll(data.token)
    } catch {
      setPhase("idle")
      setError("Couldn’t reach Telegram sign-in. Please try again.")
    }
  }

  async function social(provider: "google" | "github") {
    setOauth(provider)
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}${redirectTarget()}`,
        errorCallbackURL: `${window.location.origin}/signin`,
      })
    } catch {
      setOauth(null)
      setError("Something went wrong. Please try again.")
    }
  }

  const greeting =
    phase === "waiting"
      ? "check telegram, then tap approve"
      : phase === "expired"
        ? "that link timed out, let’s try again"
        : phase === "cancelled"
          ? "cancelled. want to try again?"
          : mode === "signup"
            ? "hey! let’s get you set up"
            : "welcome back 👋"

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-[#eef1f5] px-4 text-[#16181d]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh]"
        style={{
          background: "linear-gradient(180deg, #8cc8ff 0%, #cfe7ff 45%, rgba(238,241,245,0) 100%)",
        }}
      />

      <header className="relative flex w-full max-w-5xl items-center justify-between py-5">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-white/80 py-1.5 pl-1.5 pr-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_16px_rgba(20,60,120,0.08)] backdrop-blur"
        >
          <img
            src="/brand-mark-128.png"
            alt=""
            width={32}
            height={32}
            className="size-8 rounded-full"
          />
          <span className="text-lg font-semibold tracking-tight">Yomi</span>
        </Link>
        <Link
          href={mode === "signin" ? "/signup" : "/signin"}
          className="rounded-full bg-white/80 px-4 py-2 text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] backdrop-blur hover:bg-white"
        >
          {mode === "signin" ? "new here? sign up" : "have an account? sign in"}
        </Link>
      </header>

      <section className="relative flex w-full max-w-md flex-1 flex-col items-center justify-center pb-16 text-center">
        <img
          src="/android-chrome-192x192.png"
          alt=""
          width={112}
          height={112}
          className="size-28 rounded-[30%] shadow-[0_12px_40px_rgba(20,80,160,0.25)]"
        />
        <p
          aria-live="polite"
          className="mt-6 rounded-full bg-[#16181d] px-5 py-2.5 text-lg font-semibold text-white shadow-lg"
        >
          {greeting}
        </p>

        {phase === "waiting" && login ? (
          <div className="mt-8 w-full">
            <p className="text-sm text-[#5b6270]">your code</p>
            <p className="mt-1 font-mono text-5xl font-bold tracking-[0.3em] text-[#16181d]">
              {login.code}
            </p>
            <p className="mx-auto mt-3 max-w-xs text-sm text-[#5b6270]">
              Yomi sent you a message on Telegram. Approve it only if it shows this same code.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-[#5b6270]">
              <Loader2 size={15} className="animate-spin" /> waiting for approval…
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <a
                href={login.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-white px-6 py-3.5 text-sm font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_16px_rgba(20,60,120,0.08)] hover:bg-white/80"
              >
                Telegram didn’t open? Open it again
              </a>
              <button
                onClick={() => void start()}
                className="text-xs text-[#5b6270] underline-offset-2 hover:underline"
              >
                get a new code
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-10 w-full">
            <button
              onClick={() => void start()}
              disabled={phase === "starting" || phase === "done"}
              className="flex w-full items-center justify-center gap-2.5 rounded-full px-6 py-4 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_24px_rgba(34,158,217,0.35)] transition hover:brightness-105 disabled:opacity-70"
              style={{ background: "linear-gradient(180deg, #37aee2 0%, #1e96c8 100%)" }}
            >
              {phase === "starting" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : phase === "expired" || phase === "cancelled" ? (
                <RefreshCw size={18} />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-white">
                  <TelegramIcon size={22} />
                </span>
              )}
              Continue with Telegram
            </button>
            <p className="mx-auto mt-3 max-w-xs text-xs text-[#5b6270]">
              Yomi lives in your Telegram. No password, no email needed.
            </p>

            <div className="mt-8 flex items-center gap-3 text-xs text-[#8a909c]">
              <span className="h-px flex-1 bg-[#d9dde4]" /> or{" "}
              <span className="h-px flex-1 bg-[#d9dde4]" />
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {(["google", "github"] as const).map((provider) => (
                <button
                  key={provider}
                  onClick={() => void social(provider)}
                  disabled={oauth !== null}
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-white/80 disabled:opacity-60"
                >
                  {oauth === provider ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : provider === "google" ? (
                    "Sign in with Google"
                  ) : (
                    "Sign in with GitHub"
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-[#d6452b]">{error}</p>}
      </section>

      <footer className="relative pb-6 text-xs text-[#8a909c]">
        by continuing you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          privacy policy
        </Link>
        .
      </footer>
    </main>
  )
}
