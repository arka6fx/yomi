"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import "@/lib/telegram-webapp"

type Status = "loading" | "unlinked" | "error"

export default function TelegramAppPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>("loading")

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
          // Keep auth on the landing origin. The /api proxy forwards it to the
          // backend and returns the cookie to this same origin, so the ensuing
          // dashboard session is immediately visible to the web app.
          const res = await fetch("/api/auth/telegram-webapp-auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ initData }),
          })
          const data = (await res.json()) as { ok: boolean; linked?: boolean }
          if (data.ok && data.linked) {
            router.replace("/dashboard")
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
  }, [router])

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
