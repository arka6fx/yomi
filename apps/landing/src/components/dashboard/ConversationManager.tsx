"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, MessageSquare, RotateCcw } from "lucide-react"

type Turn = { role: "user" | "assistant" | "system"; content: string }

// The shared conversation thread Yomi keeps across your desktop and Telegram. Cloud
// canonical, so it's the same thread everywhere. Read-only here, with a reset.
export function ConversationManager({ token }: { token: string }) {
  const [history, setHistory] = useState<Turn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/conversation/shared", { headers: auth })
      if (!res.ok) throw new Error(`Couldn't load your conversation (${res.status})`)
      const data = (await res.json()) as { history?: Turn[] }
      setHistory((data.history ?? []).filter((t) => t.role !== "system"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your conversation")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setResetting(true)
    setError("")
    try {
      const res = await fetch("/api/conversation/shared/reset", { method: "POST", headers: auth })
      if (!res.ok) throw new Error("Couldn't reset the conversation")
      setHistory([])
      setConfirmReset(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the conversation")
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <MessageSquare size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              Your <span className="italic">conversation</span>
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              The thread Yomi shares across your desktop and Telegram. Recent turns are shown below.
            </p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
          >
            {resetting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            {confirmReset ? "Confirm reset?" : "Reset"}
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading your conversation…
        </div>
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No conversation yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            Talk to Yomi from the desktop app or Telegram and the thread shows up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {history.map((turn, i) => (
            <li
              key={i}
              className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  turn.role === "user"
                    ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                    : "max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-background/40 px-3.5 py-2 text-sm text-foreground"
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
