"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { BrandMark } from "@/components/BrandMark"

function mapAuthError(code: string): string {
  switch (code) {
    case "please_restart_the_process":
      return "Session expired — please try signing in again."
    case "account_not_linked":
      return "This email is already registered with a different provider."
    case "provider_rejected":
      return "Sign-in was cancelled. Please try again."
    default:
      return "Sign-in failed. Please try again."
  }
}

interface AuthCardProps {
  defaultMode: "signin" | "signup"
  plan?: string
  callbackURL?: string
  initialError?: string
}

export default function AuthCard({ defaultMode, plan, callbackURL, initialError }: AuthCardProps) {
  const [loading, setLoading] = useState<"github" | "google" | null>(null)
  const [error, setError] = useState(initialError ? mapAuthError(initialError) : "")

  // read ?error= client-side so the page can stay statically prerendered
  useEffect(() => {
    if (initialError) return
    const code = new URLSearchParams(window.location.search).get("error")
    if (code) setError(mapAuthError(code))
  }, [initialError])

  const busy = loading !== null
  const isSignup = defaultMode === "signup"

  function getRedirectTo() {
    const params = new URLSearchParams(window.location.search)
    const selectedPlan = plan ?? params.get("plan") ?? undefined
    return callbackURL ?? params.get("redirect") ?? (selectedPlan ? `/dashboard?plan=${selectedPlan}` : "/dashboard")
  }

  async function handleOAuth(provider: "github" | "google") {
    setError("")
    setLoading(provider)
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}${getRedirectTo()}`,
        // route oauth failures back to the styled signin page (reads ?error=)
        errorCallbackURL: `${window.location.origin}/signin`,
      })
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(null)
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={13} />
          Back to home
        </Link>
        {/* shown only on small screens where the brand panel is hidden */}
        <span className="lg:hidden">
          <BrandMark withText={false} size="sm" className="pointer-events-none" />
        </span>
      </div>

      <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isSignup
          ? "Start free in seconds — continue with a provider below."
          : "Sign in to your Yomi account to continue."}
      </p>

      <div className="mt-7 grid grid-cols-2 gap-3">
        <button
          onClick={() => handleOAuth("google")}
          disabled={busy}
          className="flex items-center justify-center gap-2.5 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {loading === "google" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          Google
        </button>

        <button
          onClick={() => handleOAuth("github")}
          disabled={busy}
          className="flex items-center justify-center gap-2.5 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {loading === "github" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          )}
          GitHub
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Secure OAuth — Yomi never sees your password.
      </p>

      {error && <p className="mt-4 text-center text-xs text-destructive">{error}</p>}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {isSignup ? "Already have an account? " : "New to Yomi? "}
        <Link
          href={isSignup ? "/signin" : "/signup"}
          className="font-medium text-primary transition-colors hover:text-primary/80"
        >
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground/70">
        By continuing you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">Terms</Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>.
      </p>
    </div>
  )
}
