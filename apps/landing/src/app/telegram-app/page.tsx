"use client"

import { useEffect, useState } from "react"
import { openExternal } from "@/lib/telegram-webapp"

type Status = "loading" | "unlinked" | "error" | "ready"

export default function TelegramAppPage() {
  const [status, setStatus] = useState<Status>("loading")
  const [redeemUrl, setRedeemUrl] = useState<string | null>(null)

  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://telegram.org/js/telegram-web-app.js"
    script.async = true
    script.onload = () => {
      void (async () => {
        window.Telegram?.WebApp?.ready?.()
        const initData = window.Telegram?.WebApp?.initData
        if (!initData) {
          setStatus("error")
          return
        }
        try {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""
          const res = await fetch(`${backendUrl}/api/auth/telegram-webapp-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ initData }),
          })
          if (!res.ok) {
            setStatus("error")
            return
          }
          const data = (await res.json()) as { ok: boolean; linked?: boolean; redeemUrl?: string }
          if (data.ok && data.linked && data.redeemUrl) {
            // Telegram only treats openLink() as a trusted browser-escape
            // when it's invoked synchronously from a direct tap — calling it
            // automatically here, after the async auth round-trip above,
            // gets silently ignored on mobile clients (iOS/Android) even
            // though Telegram Web/Desktop are lenient about it. So this just
            // stores the token and renders a real tappable link; the actual
            // openExternal() call happens in that link's own onClick, where
            // it's still inside the tap's call stack on every client.
            setRedeemUrl(data.redeemUrl)
            setStatus("ready")
          } else {
            setStatus("unlinked")
          }
        } catch {
          setStatus("error")
        }
      })()
    }
    script.onerror = () => setStatus("error")
    document.body.appendChild(script)
    return () => {
      document.body.removeChild(script)
    }
  }, [])

  if (status === "ready") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">Tap below to open your dashboard in the browser.</p>
        {redeemUrl && (
          <a
            href={redeemUrl}
            onClick={(e) => {
              e.preventDefault()
              openExternal(redeemUrl)
            }}
            className="text-sm font-medium text-primary underline"
          >
            Open dashboard
          </a>
        )}
      </main>
    )
  }

  if (status === "unlinked") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Your Telegram account isn&apos;t linked to a Yomi account yet.
        </p>
        <a href="/link" className="text-sm font-medium text-primary underline">
          Link your account
        </a>
      </main>
    )
  }

  if (status === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t open the dashboard. Please try again from Telegram.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  )
}
