"use client"

import { useEffect, useState } from "react"
import { openExternal } from "@/lib/telegram-webapp"

type Status = "loading" | "unlinked" | "error" | "opened"

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
          const data = (await res.json()) as { ok: boolean; linked?: boolean; redeemUrl?: string }
          if (data.ok && data.linked && data.redeemUrl) {
            openExternal(data.redeemUrl)
            setRedeemUrl(data.redeemUrl)
            setStatus("opened")
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

  if (status === "opened") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Opened your dashboard in the browser — tap back to chat.
        </p>
        {redeemUrl && (
          <a href={redeemUrl} className="text-sm font-medium text-primary underline">
            Didn&apos;t open? Tap here
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
