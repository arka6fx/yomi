"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { BrandMark } from "@/components/BrandMark"
import { TelegramIcon } from "@/components/TelegramIcon"
import { Mascot } from "@/components/Mascot"

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
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-[radial-gradient(70%_45%_at_50%_0%,#d7e9f8_0%,transparent_70%)] px-4 text-foreground">
      <header className="flex w-full justify-center pt-6">
        <BrandMark />
      </header>

      <section className="flex w-full max-w-xl flex-1 flex-col pb-8">
        {phase === "waiting" && login ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">your code</p>
            <p className="mt-1 font-mono text-5xl font-bold tracking-[0.3em]">{login.code}</p>
            <p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">
              Yomi sent you a message on Telegram. Approve it only if it shows this same code.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> waiting for approval…
            </div>
          </div>
        ) : (
          // decorative preview of a chat with yomi
          <div aria-hidden className="mt-10 flex flex-1 flex-col items-center">
            <Mascot pose="waving" float className="w-20" />
            <p className="mt-1.5 text-xs font-semibold text-muted-foreground">yomi</p>
            <div className="mt-6 w-full max-w-sm space-y-2.5">
              <p className="bubble-in w-fit max-w-[80%] px-4 py-2.5 text-[15px] font-medium">
                {mode === "signup"
                  ? "it’s 9pm. you said you’d finish the deck today 👀"
                  : "morning! 3 meetings today and sarah replied 📬"}
              </p>
              <p className="bubble-out ml-auto w-fit max-w-[80%] px-4 py-2.5 text-[15px] font-medium">
                {mode === "signup"
                  ? "i know 😭 block 2 hours tomorrow?"
                  : "draft a reply for me pls"}
              </p>
            </div>
          </div>
        )}

        <div className="mt-10 text-center">
          <h1
            aria-live="polite"
            className="text-3xl font-semibold leading-tight tracking-[-0.03em]"
          >
            {phase === "idle" && mode === "signup" ? (
              <>
                the assistant in your telegram
                <br />
                that gets stuff done
              </>
            ) : (
              greeting
            )}
          </h1>

          {phase === "waiting" && login ? (
            <div className="mt-6 flex flex-col gap-2">
              <a
                href={login.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-key py-3.5 text-sm"
              >
                Telegram didn’t open? Open it again
              </a>
              <button
                onClick={() => void start()}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                get a new code
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => void start()}
                disabled={phase === "starting" || phase === "done"}
                className="btn-telegram mt-6 w-full py-4 text-base disabled:opacity-70"
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
              <p className="mx-auto mt-3 max-w-xs text-xs text-muted-foreground">
                Yomi lives in your Telegram. No password, no email needed.
              </p>

              <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or{" "}
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="mt-4 flex justify-center gap-2">
                {(["google", "github"] as const).map((provider) => (
                  <button
                    key={provider}
                    onClick={() => void social(provider)}
                    disabled={oauth !== null}
                    className="btn-key px-5 py-2.5 text-sm disabled:opacity-60"
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
            </>
          )}

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

          <p className="mt-6 text-sm text-muted-foreground">
            {mode === "signin" ? "new here? " : "already have an account? "}
            <Link
              href={mode === "signin" ? "/signup" : "/signin"}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              {mode === "signin" ? "sign up" : "log in"}
            </Link>
          </p>
        </div>
      </section>

      <footer className="pb-6 text-xs text-muted-foreground">
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
