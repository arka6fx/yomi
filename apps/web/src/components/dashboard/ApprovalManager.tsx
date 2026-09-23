"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react"

type Action = { id: string; connector: string; action: string; risk: string; title: string; preview: string; confirmText?: string | null; createdAt?: string }

export function ApprovalManager({ token }: { token: string }) {
  const [actions, setActions] = useState<Action[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/actions/pending", { headers: auth })
      if (!response.ok) throw new Error("Couldn’t load approvals")
      const data = (await response.json()) as { actions?: Action[] }
      setActions(data.actions ?? [])
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn’t load approvals") } finally { setLoading(false) }
  }, [token])

  useEffect(() => { void load() }, [load])

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id)
    try {
      const response = await fetch(`/api/actions/${id}/${decision}`, { method: "POST", headers: auth })
      if (!response.ok) throw new Error("Couldn’t update approval")
      setActions((current) => current.filter((action) => action.id !== id))
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn’t update approval") } finally { setBusy(null) }
  }

  return <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
    <div className="mb-5 flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-300"><ShieldAlert size={18} /></div><div><h2 className="text-lg font-medium text-foreground">Approvals</h2><p className="mt-1 text-sm text-muted-foreground">Review consequential actions before Yomi sends, changes, buys, or deletes anything.</p></div></div><button onClick={() => void load()} disabled={loading} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground disabled:opacity-50" aria-label="Refresh approvals"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button></div>
    {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
    {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Loading approvals…</div> : actions.length === 0 ? <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center"><Check size={18} className="mx-auto text-emerald-400" /><p className="mt-2 text-sm font-medium text-foreground">You’re all caught up</p><p className="mt-1 text-xs text-muted-foreground">Yomi will bring actions here when your approval is needed.</p></div> : <div className="space-y-3">{actions.map((item) => <div key={item.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><div className="flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium text-foreground">{item.title}</h3><span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">{item.risk} risk</span></div><p className="mt-1 text-sm text-muted-foreground">{item.preview}</p><p className="mt-2 text-[11px] text-muted-foreground">{item.connector} · {item.action}</p></div></div><div className="mt-4 flex justify-end gap-2"><button onClick={() => void decide(item.id, "reject")} disabled={busy === item.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"><X size={13} /> Reject</button><button onClick={() => void decide(item.id, "approve")} disabled={busy === item.id} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Check size={13} /> {busy === item.id ? "Saving…" : item.confirmText || "Approve"}</button></div></div>)}</div>}
  </section>
}
