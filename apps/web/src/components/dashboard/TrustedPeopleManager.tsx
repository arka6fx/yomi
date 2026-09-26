"use client"

import { useCallback, useEffect, useState } from "react"
import { UserPlus } from "lucide-react"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"
import { ListSkeleton } from "@/components/dashboard/shell/motion"

type Person = {
  id: string
  personId: string
  name: string | null
  email: string | null
  note: string | null
  since: string | null
}

type Overview = {
  requests: Person[]
  sent: Person[]
  trusted: Person[]
  blocked: Person[]
  paused: boolean
}

type Action = "accept" | "decline" | "block" | "unblock" | "remove"

const EMPTY: Overview = { requests: [], sent: [], trusted: [], blocked: [], paused: false }

export function TrustedPeopleManager({ token }: { token: string }) {
  const [data, setData] = useState<Overview>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [showBlocked, setShowBlocked] = useState(false)

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`/api/trust${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok)
        throw new Error(typeof body.detail === "string" ? body.detail : "Something went wrong")
      return body
    },
    [token],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setData((await call("")) as unknown as Overview)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load trusted people")
    } finally {
      setLoading(false)
    }
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError("")
    setNotice("")
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  const act = (id: string, action: Action) =>
    run(`${id}:${action}`, () => call(`/${id}/${action}`, { method: "POST" }))

  async function invite() {
    if (!email.trim()) return
    await run("invite", async () => {
      const body = await call("/requests", { method: "POST", body: JSON.stringify({ email }) })
      setNotice(String(body.message ?? "Request sent"))
      setEmail("")
    })
  }

  const button = (id: string, action: Action, label: string, primary = false) => (
    <button
      onClick={() => void act(id, action)}
      disabled={busy !== null}
      className={
        primary
          ? "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          : "rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      }
    >
      {busy === `${id}:${action}` ? "…" : label}
    </button>
  )

  const list = (people: Person[], empty: string, actions: (p: Person) => React.ReactNode) =>
    people.length === 0 ? (
      <p className="py-2 text-sm text-muted-foreground">{empty}</p>
    ) : (
      <ul className="divide-y divide-border">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[p.email, p.note].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex gap-2">{actions(p)}</div>
          </li>
        ))}
      </ul>
    )

  const heading = (title: string, subtitle: string) => (
    <div className="border-b border-border pb-2 pt-5">
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )

  return (
    <section className="space-y-6 pt-6">
      <PageHeader
        title="trusted people"
        subtitle="people whose yomi can message yours, for example to find a time that works. you approve every message your yomi sends."
      />
      <div className={cn(SURFACE, "p-5 sm:p-6")}>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        {notice && <p className="mt-3 text-xs text-emerald-400">{notice}</p>}

        {loading ? (
          <ListSkeleton label="loading trusted people" />
        ) : data.paused ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Connections paused</p>
              <p className="text-xs text-muted-foreground">
                Your Yomi isn’t exchanging messages with other people’s. Resume to see your trusted
                people and pending requests.
              </p>
            </div>
            <button
              onClick={() =>
                void run("pause", () =>
                  call("/pause", { method: "POST", body: JSON.stringify({ paused: false }) }),
                )
              }
              disabled={busy !== null}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Resume
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void invite()}
                placeholder="Their Yomi account email"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                onClick={() => void invite()}
                disabled={busy !== null || !email.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <UserPlus size={14} /> Connect
              </button>
            </div>

            {heading("Requests", "People asking to connect their Yomi to yours")}
            {list(data.requests, "No pending requests", (p) => (
              <>
                {button(p.id, "block", "Block")}
                {button(p.id, "decline", "Decline")}
                {button(p.id, "accept", "Accept", true)}
              </>
            ))}

            {data.sent.length > 0 && (
              <>
                {heading("Sent", "Waiting for them to accept")}
                {list(data.sent, "", (p) => button(p.id, "remove", "Cancel"))}
              </>
            )}

            {heading("Trusted people", "Their Yomi can reach yours")}
            {list(data.trusted, "No trusted people yet", (p) => (
              <>
                {button(p.id, "block", "Block")}
                {button(p.id, "remove", "Remove")}
              </>
            ))}

            <button onClick={() => setShowBlocked((v) => !v)} className="w-full text-left">
              {heading(`Blocked (${data.blocked.length})`, "Their Yomi can’t reach yours")}
            </button>
            {showBlocked &&
              list(data.blocked, "Nobody blocked", (p) => button(p.id, "unblock", "Unblock"))}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <div>
                <p className="text-sm font-medium text-foreground">Connections active</p>
                <p className="text-xs text-muted-foreground">
                  Your Yomi can exchange messages with the Yomi of people you trust.
                </p>
              </div>
              <button
                onClick={() =>
                  void run("pause", () =>
                    call("/pause", { method: "POST", body: JSON.stringify({ paused: true }) }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Pause connections
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
