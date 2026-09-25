"use client"

import { useCallback, useEffect, useState } from "react"
import {
  CreditCard,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Plus,
  Bot,
  Trash2,
  X,
} from "lucide-react"

type Kind = "login" | "card" | "address" | "phone" | "agent_item"

type VaultItem = {
  id: string
  kind: Kind
  label: string
  owner: string
  fields: Record<string, string | number>
  hasSecret: boolean
  lastUsedAt: string | null
}

type Payment = {
  id: string
  card: string | null
  merchant: string
  amount: number
  currency: string
  purpose: string | null
  status: string
  createdAt: string
}

type ReceiptRow = {
  id: string
  merchant: string
  amount: number
  currency: string
  date: string
}

type Field = {
  key: string
  label: string
  secret?: boolean
  placeholder?: string
  optional?: boolean
}

const FORMS: Record<
  Exclude<Kind, "agent_item">,
  { title: string; namePlaceholder: string; fields: Field[] }
> = {
  login: {
    title: "Add login",
    namePlaceholder: "e.g. “Gmail”, “GitHub”",
    fields: [
      { key: "url", label: "Website", placeholder: "https://", optional: true },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
    ],
  },
  card: {
    title: "Add card",
    namePlaceholder: "e.g. “HDFC Visa”, “Amex”",
    fields: [
      { key: "number", label: "Card number", secret: true, placeholder: "0000 0000 0000 0000" },
      { key: "exp_month", label: "Expiry month", placeholder: "MM" },
      { key: "exp_year", label: "Expiry year", placeholder: "YY" },
      { key: "cvv", label: "CVV", secret: true },
      { key: "cardholder", label: "Name on card", optional: true },
      { key: "billing_zip", label: "Billing ZIP / PIN", optional: true },
      { key: "currency", label: "Currency", placeholder: "INR", optional: true },
      {
        key: "monthly_limit",
        label: "Monthly agent spend limit",
        placeholder: "e.g. 5000",
        optional: true,
      },
    ],
  },
  address: {
    title: "Add address",
    namePlaceholder: "e.g. “Home”, “Work”",
    fields: [
      { key: "line1", label: "Address line 1" },
      { key: "line2", label: "Address line 2", optional: true },
      { key: "city", label: "City" },
      { key: "state", label: "State", optional: true },
      { key: "postal_code", label: "Postal code", optional: true },
      { key: "country", label: "Country" },
    ],
  },
  phone: {
    title: "Add phone",
    namePlaceholder: "e.g. “Mobile”",
    fields: [{ key: "number", label: "Phone number", placeholder: "+91…" }],
  },
}

function describe(item: VaultItem): string {
  const f = item.fields
  switch (item.kind) {
    case "login":
    case "agent_item":
      return [f.username, f.url ?? f.service].filter(Boolean).join(" · ")
    case "card":
      return `${f.brand ?? "Card"} ••${f.last4 ?? ""} · ${f.exp_month}/${f.exp_year}${
        f.monthly_limit ? ` · limit ${f.monthly_limit} ${f.currency ?? ""}/mo` : ""
      }`
    case "address":
      return [f.line1, f.line2, f.city, f.state, f.postal_code, f.country]
        .filter(Boolean)
        .join(", ")
    case "phone":
      return String(f.number ?? "")
  }
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function VaultManager({ token }: { token: string }) {
  const [items, setItems] = useState<VaultItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [monthTotals, setMonthTotals] = useState<Record<string, number>>({})
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [adding, setAdding] = useState<Exclude<Kind, "agent_item"> | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [showAgentItems, setShowAgentItems] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [itemsRes, paymentsRes] = await Promise.all([
        fetch("/api/vault/items", { headers }),
        fetch("/api/vault/payments", { headers }),
      ])
      if (!itemsRes.ok || !paymentsRes.ok) throw new Error("Couldn’t load your vault")
      const itemsData = (await itemsRes.json()) as { items: VaultItem[] }
      const paymentsData = (await paymentsRes.json()) as {
        payments: Payment[]
        monthTotals: Record<string, number>
        receipts?: ReceiptRow[]
      }
      setItems(itemsData.items)
      setPayments(paymentsData.payments)
      setMonthTotals(paymentsData.monthTotals)
      setReceipts(paymentsData.receipts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load your vault")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  function open(kind: Exclude<Kind, "agent_item">) {
    setAdding(kind)
    setDraft({})
    setError("")
  }

  const form = adding ? FORMS[adding] : null
  const canSave =
    !!form && !!draft.label?.trim() && form.fields.every((f) => f.optional || draft[f.key]?.trim())

  async function save() {
    if (!adding || !canSave) return
    setSaving(true)
    setError("")
    try {
      const { label, ...fields } = draft
      const res = await fetch("/api/vault/items", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: adding, label, fields }),
      })
      const data = (await res.json()) as { item?: VaultItem; detail?: string }
      if (!res.ok || !data.item) throw new Error(data.detail ?? "Couldn’t save")
      setItems((current) => [...current, data.item as VaultItem])
      setAdding(null)
      setDraft({})
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/vault/items/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setItems((current) => current.filter((item) => item.id !== id))
    else setError("Couldn’t delete that item")
  }

  const section = (title: string, kinds: Kind[], empty: string, add: React.ReactNode) => {
    const rows = items.filter((item) => kinds.includes(item.kind))
    return (
      <div className="border-b border-border pb-5">
        <div className="flex items-center justify-between py-3">
          <h3 className="text-base font-medium text-foreground">{title}</h3>
          {add}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((item) => {
              const Icon =
                item.kind === "card"
                  ? CreditCard
                  : item.kind === "address"
                    ? MapPin
                    : item.kind === "phone"
                      ? Phone
                      : item.kind === "agent_item"
                        ? Bot
                        : KeyRound
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <Icon size={16} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{describe(item)}</p>
                  </div>
                  {item.hasSecret && (
                    <Lock size={12} className="text-muted-foreground" aria-label="Encrypted" />
                  )}
                  <button
                    onClick={() => void remove(item.id)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${item.label}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  const addButton = (kind: Exclude<Kind, "agent_item">, label: string) => (
    <button
      onClick={() => open(kind)}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      aria-label={label}
    >
      <Plus size={15} />
    </button>
  )

  const agentItems = items.filter((item) => item.kind === "agent_item")

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-2">
        <h2 className="text-lg font-medium text-foreground">Vault</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Encrypted details Yomi can use for you. Passwords and card numbers are typed straight into
          your private computer and never shown to the AI. Every card payment needs your approval.
        </p>
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" /> Loading vault…
        </div>
      ) : (
        <div className="space-y-2">
          {section("Logins", ["login"], "No logins saved", addButton("login", "Add login"))}
          {section("Cards", ["card"], "No cards saved", addButton("card", "Add card"))}
          {section(
            "Personal info",
            ["address", "phone"],
            "No personal info saved",
            <div className="flex gap-1">
              <button
                onClick={() => open("address")}
                className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Add address
              </button>
              <button
                onClick={() => open("phone")}
                className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Add phone
              </button>
            </div>,
          )}

          <div className="border-b border-border pb-5">
            <button
              onClick={() => setShowAgentItems((v) => !v)}
              className="flex w-full items-center justify-between py-3 text-left"
            >
              <div>
                <h3 className="text-base font-medium text-foreground">
                  Agent items ({agentItems.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  Accounts Yomi created for you. They stay in your vault and under your control.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {showAgentItems ? "Hide" : "Show"}
              </span>
            </button>
            {showAgentItems && section("", ["agent_item"], "No agent items yet", null)}
          </div>

          <div className="pt-2">
            <h3 className="py-3 text-base font-medium text-foreground">Agent spending</h3>
            <p className="text-sm text-muted-foreground">
              This month:{" "}
              {Object.keys(monthTotals).length === 0
                ? "nothing spent"
                : Object.entries(monthTotals)
                    .map(([currency, amount]) => money(amount, currency))
                    .join(" · ")}
            </p>
            {payments.length > 0 && (
              <ul className="mt-3 divide-y divide-border">
                {payments.slice(0, 20).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{p.merchant}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[p.card, p.purpose, new Date(p.createdAt).toLocaleDateString()]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-foreground">{money(p.amount, p.currency)}</p>
                      <p className="text-[11px] capitalize text-muted-foreground">{p.status}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="pb-1 pt-6 text-base font-medium text-foreground">Receipts</h3>
            <p className="text-xs text-muted-foreground">
              Found in emails sent to your Yomi address (see Email).
            </p>
            {receipts.length === 0 ? (
              <p className="pt-2 text-sm text-muted-foreground">No receipts yet</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {receipts.slice(0, 20).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{r.merchant}</p>
                      <p className="text-xs text-muted-foreground">{r.date}</p>
                    </div>
                    <p className="text-foreground">{money(r.amount, r.currency)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={form.title}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium text-foreground">{form.title}</h3>
              <button
                onClick={() => setAdding(null)}
                aria-label="Close"
                className="text-muted-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              {[
                { key: "label", label: "Name", placeholder: form.namePlaceholder } as Field,
                ...form.fields,
              ].map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                    {field.secret && <Lock size={11} />}
                    {field.label}
                    {field.optional && " (optional)"}
                  </span>
                  <input
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    value={draft[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setAdding(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={!canSave || saving}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
