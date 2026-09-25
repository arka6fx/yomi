"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, Loader2, Mail, Receipt } from "lucide-react"

type InboxEmail = {
  id: string
  from: string
  subject: string
  snippet: string
  kind: "email" | "receipt"
  unread: boolean
  receivedAt: string
}

type FullEmail = { id: string; from: string; subject: string; body: string; receivedAt: string }

export function EmailManager({ token }: { token: string }) {
  const [address, setAddress] = useState("")
  const [emails, setEmails] = useState<InboxEmail[]>([])
  const [open, setOpen] = useState<FullEmail | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/email", { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error("Couldn’t load your inbox")
      const data = (await res.json()) as { address: string; emails: InboxEmail[] }
      setAddress(data.address)
      setEmails(data.emails)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load your inbox")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function show(id: string) {
    const res = await fetch(`/api/email/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return setError("Couldn’t open that email")
    setOpen((await res.json()) as FullEmail)
    setEmails((current) => current.map((e) => (e.id === id ? { ...e, unread: false } : e)))
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError("Couldn’t copy — select the address instead")
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-medium text-foreground">Email</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your Yomi’s own address. Forward receipts, tickets and bookings here, or use it for
        sign-ups. Yomi tells you on Telegram when mail arrives and logs receipts to your spending.
      </p>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-border p-4">
            <Mail size={18} className="shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{address}</p>
            <button
              onClick={() => void copy()}
              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Copy email address"
            >
              {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
            </button>
          </div>

          <h3 className="mt-6 border-b border-border pb-2 text-base font-medium text-foreground">
            Inbox
          </h3>
          {emails.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No emails yet</p>
          ) : (
            <ul className="divide-y divide-border">
              {emails.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => void show(e.id)}
                    className="flex w-full items-start gap-3 py-3 text-left"
                  >
                    {e.kind === "receipt" ? (
                      <Receipt
                        size={15}
                        className="mt-0.5 shrink-0 text-emerald-400"
                        aria-label="Receipt"
                      />
                    ) : (
                      <Mail size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${e.unread ? "font-medium text-foreground" : "text-foreground/80"}`}
                      >
                        {e.subject || "(no subject)"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.from} · {e.snippet}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(e.receivedAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={open.subject || "Email"}
          onClick={() => setOpen(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-foreground">
              {open.subject || "(no subject)"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {open.from} · {new Date(open.receivedAt).toLocaleString()}
            </p>
            <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm text-foreground">
              {open.body}
            </pre>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setOpen(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
