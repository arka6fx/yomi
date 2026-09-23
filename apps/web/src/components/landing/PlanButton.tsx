"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { openExternal } from "@/lib/telegram-webapp"

// The plan cards are static markup rendered on the server; only the button needs a session
// and a checkout call, so only the button is a client component.
export function PlanButton({
  planKey,
  label,
  popular,
}: {
  planKey: string
  label: string
  popular: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const { data: session } = authClient.useSession()
  const router = useRouter()

  async function handleClick() {
    if (planKey === "explore") {
      router.push(session ? "/dashboard" : "/signup")
      return
    }
    if (!session) {
      router.push(`/signup?plan=${planKey}`)
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.cause ?? data.error ?? "Billing error")
      // Payment pages need a full browser when Yomi is opened in Telegram.
      openExternal(data.short_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start checkout")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-70 ${
          popular
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-border text-foreground hover:bg-muted/50"
        }`}
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading ? "Redirecting..." : label}
      </button>
      {error && <p className="text-center text-xs text-destructive">{error}</p>}
    </div>
  )
}
