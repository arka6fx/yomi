"use client"

import { useEffect, useState } from "react"

// Wire-compatible replacement for the retired @better-auth/react client.
// The auth server is the Python port in apps/backend (yomi.app.routes.auth):
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
let sessionPromise: Promise<SessionResult | null> | null = null

function fetchSession(): Promise<SessionResult | null> {
  return fetch("/api/auth/get-session", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: SessionResult | null) => (body?.session ? body : null))
    .catch(() => null)
}

function getSession(): Promise<SessionResult | null> {
  if (!sessionPromise) sessionPromise = fetchSession()
  return sessionPromise
}

function invalidateSession(): void {
  sessionPromise = null
}

export function useSession() {
  const [data, setData] = useState<SessionResult | undefined>(undefined)
  const [isPending, setIsPending] = useState(true)

  useEffect(() => {
    let alive = true
    setIsPending(true)
    getSession().then((value) => {
      if (!alive) return
      setData(value)
      setIsPending(false)
    })
    return () => {
      alive = false
    }
  }, [])

  return { data, isPending }
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
