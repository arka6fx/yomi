"use client"

import { useEffect, useState } from "react"
import { isTelegramOpenLinkAvailable } from "@/lib/telegram-webapp"

type Status = "loading" | "unlinked" | "error" | "opened"

export default function TelegramAppPage() {
  const [status, setStatus] = useState<Status>("loading")
  const [redeemUrl, setRedeemUrl] = useState<string | null>(null)
  const [openedAutomatically, setOpenedAutomatically] = useState(false)

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
            // The token is single-use, so it must be consumed exactly once —
            // by whichever browser context actually ends up with the
            // session. If openLink() can escape to a real external browser,
            // fire it there. If it can't, the ONLY safe move is to leave the
            // token untouched and let the user tap the link themselves —
            // falling back to a same-tab navigation here would burn the
            // token inside this same embedded webview, which is the exact
            // failure this flow exists to avoid.
            if (isTelegramOpenLinkAvailable()) {
              window.Telegram?.WebApp?.openLink?.(data.redeemUrl, { try_instant_view: false })
              setOpenedAutomatically(true)
            }
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
          {openedAutomatically
            ? "Opened your dashboard in the browser — tap back to chat."
            : "Tap below to open your dashboard in the browser."}
        </p>
        {redeemUrl && (
          <a href={redeemUrl} className="text-sm font-medium text-primary underline">
            {openedAutomatically ? <>Didn&apos;t open? Tap here</> : "Open dashboard"}
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
