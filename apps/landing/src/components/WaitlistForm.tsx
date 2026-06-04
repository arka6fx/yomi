"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface WaitlistFormProps {
  compact?: boolean
}

export default function WaitlistForm({ compact = false }: WaitlistFormProps) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [message, setMessage] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return

    setStatus("loading")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        setStatus("success")
        setMessage("You're on the list. We'll reach out when it's ready.")
        setEmail("")
      } else {
        const data = await res.json()
        setStatus("error")
        setMessage(data.error || "Something went wrong. Try again.")
      }
    } catch {
      setStatus("error")
      setMessage("Network error. Please try again.")
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-center gap-3 text-sm py-3">
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        <p className="text-label/80">{message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={handleSubmit}
        className={compact ? "flex gap-2" : "flex flex-col sm:flex-row gap-3"}
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          disabled={status === "loading"}
        />
        <Button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Joining…" : "Join waitlist"}
        </Button>
      </form>
      {status === "error" && <p className="text-xs text-red-400 pl-1">{message}</p>}
    </div>
  )
}
