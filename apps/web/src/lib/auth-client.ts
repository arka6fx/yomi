"use client"

import { useCallback, useEffect, useState } from "react"

// Wire-compatible replacement for the retired @better-auth/react client.
// The auth server is the Python port in apps/api (yomi.app.routes.auth):
//
//   POST /api/auth/sign-in/social/{provider}  -> {url, redirect}
//   GET  /api/auth/get-session                -> {session, user} | null
//   POST /api/auth/sign-out                   -> {success: true}
//   POST /api/auth/revoke-sessions            -> {status: true}
//
// Requests use relative URLs so the landing worker's /api/* proxy (prod) and
// next.config rewrites (dev) route them to the backend from the same origin —
// the session cookie always travels on the origin, no CORS involved.

export type AuthSession = {
  id: string
  token: string
  userId: string
  expiresAt: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  updatedAt: string
}

export type AuthUser = {
  id: string
  name: string | null
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
  role: string
  plan: string
  subscriptionStatus: string
  trialStartDate: string | null
  trialEndDate: string | null
  currentPeriodEnd: string | null
  dodoCustomerId: string | null
  dodoSubscriptionId: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatCount: number
  dailyVoiceCount: number
  dailyImageCount: number
  agentUsageCount: number
  dailyResetDate: string | null
  deletedAt: string | null
  agentSoul: string | null
}

export type SessionResult = { session: AuthSession; user: AuthUser } | null

// Module-level cache so several components mounting on the same page share one
// get-session round trip. Invalidated on sign-out so a navigated-to page
// refetches instead of reusing a stale session.
type SessionFetch = { data: SessionResult | null; transientError: boolean }

let sessionPromise: Promise<SessionFetch> | null = null

async function fetchSession(): Promise<SessionFetch> {
  // Deploys briefly return 502/503 while the new container starts. Treat that
  // as an unavailable session endpoint, not as a signed-out user.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch("/api/auth/get-session", { credentials: "same-origin" })
      if (res.ok) {
        const body = (await res.json()) as SessionResult | null
        return { data: body?.session ? body : null, transientError: false }
      }
      if (![408, 425, 429, 500, 502, 503, 504].includes(res.status)) {
        return { data: null, transientError: false }
      }
    } catch {
      // Network handover during a Worker/container rollout is retryable.
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
  return { data: null, transientError: true }
}

function getSession(): Promise<SessionFetch> {
  if (!sessionPromise) sessionPromise = fetchSession()
  return sessionPromise
}

function invalidateSession(): void {
  sessionPromise = null
}

export function useSession() {
  const [data, setData] = useState<SessionResult | undefined>(undefined)
  const [isPending, setIsPending] = useState(true)
  const [isError, setIsError] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    if (version === 0) setIsPending(true)
    getSession().then(({ data: value, transientError }) => {
      if (!alive) return
      setData(value)
      setIsError(transientError)
      setIsPending(false)
    })
    return () => {
      alive = false
    }
  }, [version])

  // Re-read the session after a profile change (e.g. a new picture). Keeps the
  // current data on screen until the fresh copy arrives.
  const refetch = useCallback(() => {
    invalidateSession()
    setVersion((v) => v + 1)
  }, [])

  return { data, isPending, isError, refetch }
}

export async function signInSocial(opts: {
  provider: "google" | "github"
  callbackURL?: string
  errorCallbackURL?: string
  disableRedirect?: boolean
}) {
  const res = await fetch(`/api/auth/sign-in/social/${opts.provider}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      callbackURL: opts.callbackURL,
      errorCallbackURL: opts.errorCallbackURL,
      disableRedirect: opts.disableRedirect,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { url: string; redirect: boolean }
  if (!res.ok) throw new Error("Sign-in failed. Please try again.")
  if (!opts.disableRedirect && body.redirect && body.url) {
    window.location.href = body.url
  }
  return { data: body }
}

export async function signOut(): Promise<void> {
  invalidateSession()
  try {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" })
  } catch {
    // best-effort — the session may already be gone (revoke-then-sign-out)
  }
}

export async function revokeSessions(): Promise<void> {
  invalidateSession()
  const res = await fetch("/api/auth/revoke-sessions", {
    method: "POST",
    credentials: "same-origin",
  })
  if (!res.ok) throw new Error("Failed to revoke sessions")
}

export const authClient = {
  useSession,
  signIn: { social: signInSocial },
  signOut,
  revokeSessions,
}
