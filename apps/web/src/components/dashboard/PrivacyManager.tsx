"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AudioLines,
  BarChart3,
  Brain,
  Download,
  FolderSearch,
  Loader2,
  MessageSquare,
  Package,
  Plug,
  Send,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import {
  PRIVACY_CONSENT_PURPOSES,
  PRIVACY_CONSENT_PURPOSE_LABELS,
  PRIVACY_CONSENT_PURPOSE_DESCRIPTIONS,
  type PrivacyConsentPurpose,
} from "@yomi/shared/privacy"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"

const PURPOSE_ICONS: Record<PrivacyConsentPurpose, LucideIcon> = {
  conversation_history: MessageSquare,
  memory: Brain,
  cloud_memory: FolderSearch,
  connector_data: Plug,
  analytics: BarChart3,
  voice_processing: AudioLines,
  ai_improvement: Sparkles,
  telegram_processing: Send,
}

type ConsentStatus = {
  purpose: string
  status: "granted" | "revoked"
  consentVersion: string
  createdAt: string
}

type JobRow = {
  id: string
  status: string
  format?: string
  error: string | null
  requestedAt: string
  completedAt: string | null
  expiresAt?: string | null
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600",
  completed_with_errors: "bg-amber-500/10 text-amber-600",
  processing: "bg-amber-500/10 text-amber-600",
  running: "bg-amber-500/10 text-amber-600",
  failed: "bg-destructive/10 text-destructive",
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status === "completed_with_errors" ? "done, with errors" : status}
    </span>
  )
}

function Switch({
  on,
  disabled,
  label,
  onClick,
}: {
  on: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50",
        on ? "bg-[#2b8fff]" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-white shadow transition-all",
          on ? "left-6" : "left-1",
        )}
      />
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 text-sm font-medium text-muted-foreground">{children}</h2>
}

// Privacy: what Yomi may use (all on by default, switch any off), exports, and
// deletion. A purpose counts as on unless the user has explicitly revoked it.
export function PrivacyManager({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [consents, setConsents] = useState<ConsentStatus[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [exports, setExports] = useState<JobRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteJobs, setDeleteJobs] = useState<JobRow[]>([])
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deleteAccountText, setDeleteAccountText] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)

  const auth = useCallback(
    (json = false): HeadersInit => ({
      Authorization: `Bearer ${token}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    }),
    [token],
  )

  const fetchOverview = useCallback(async () => {
    setError(null)
    try {
      const [consentRes, exportsRes, deleteRes] = await Promise.all([
        fetch("/api/privacy/consents", { headers: auth() }),
        fetch("/api/privacy/exports", { headers: auth() }),
        fetch("/api/privacy/delete-data", { headers: auth() }),
      ])
      if (!consentRes.ok)
        throw new Error(`Couldn't load your privacy settings (${consentRes.status})`)
      const consentData = (await consentRes.json()) as { consents?: ConsentStatus[] }
      setConsents(consentData.consents ?? [])
      if (exportsRes.ok)
        setExports(((await exportsRes.json()) as { exports?: JobRow[] }).exports ?? [])
      if (deleteRes.ok) setDeleteJobs(((await deleteRes.json()) as { jobs?: JobRow[] }).jobs ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your privacy settings")
    } finally {
      setLoading(false)
    }
  }, [auth])

  useEffect(() => {
    if (token) void fetchOverview()
  }, [token, fetchOverview])

  function isOn(purpose: string): boolean {
    return consents.find((c) => c.purpose === purpose)?.status !== "revoked"
  }

  async function toggle(purpose: PrivacyConsentPurpose) {
    const next = !isOn(purpose)
    setSaving(purpose)
    setActionError(null)
    const previous = consents
    // Optimistic: the knob shouldn't sit frozen for the round trip.
    setConsents((current) => [
      ...current.filter((c) => c.purpose !== purpose),
      {
        purpose,
        status: next ? "granted" : "revoked",
        consentVersion: "",
        createdAt: new Date().toISOString(),
      },
    ])
    try {
      const res = await fetch(next ? "/api/privacy/consents" : "/api/privacy/consents/revoke", {
        method: "POST",
        headers: auth(true),
        body: JSON.stringify({ purposes: [purpose] }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setConsents(previous)
      setActionError("Couldn't update that setting. Try again.")
    } finally {
      setSaving(null)
    }
  }

  async function requestExport() {
    setExporting(true)
    setActionError(null)
    try {
      const res = await fetch("/api/privacy/exports", { method: "POST", headers: auth() })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { export: JobRow }
      setExports((prev) => [data.export, ...prev])
    } catch {
      setActionError("Export request failed. Try again.")
    } finally {
      setExporting(false)
    }
  }

  async function deleteData() {
    setDeleting(true)
    setActionError(null)
    try {
      const res = await fetch("/api/privacy/delete-data", { method: "POST", headers: auth() })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { job: JobRow }
      setDeleteJobs((prev) => [data.job, ...prev])
    } catch {
      setActionError("Data deletion failed to start. Try again.")
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true)
    setActionError(null)
    try {
      const res = await fetch("/api/privacy/delete-account", { method: "POST", headers: auth() })
      if (res.ok) {
        window.location.href = "/"
        return
      }
      setActionError("Account deletion failed. Try again or contact support.")
    } catch {
      setActionError("Account deletion failed. Try again or contact support.")
    } finally {
      setDeletingAccount(false)
      setConfirmDeleteAccount(false)
      setDeleteAccountText("")
    }
  }

  const offCount = PRIVACY_CONSENT_PURPOSES.filter((p) => !isOn(p)).length

  return (
    <section className="space-y-8 pt-6">
      <PageHeader
        title="privacy"
        subtitle="everything is on so yomi works at its best. switch off anything you'd rather it didn't use, export your data, or delete it."
      />

      {error ? (
        <div className={cn(SURFACE, "p-6 text-center")}>
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => {
              setLoading(true)
              void fetchOverview()
            }}
            className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
          >
            retry
          </button>
        </div>
      ) : (
        <>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          <div className="space-y-3">
            <SectionTitle>
              what yomi can use
              {!loading && offCount > 0 && (
                <span className="text-muted-foreground/70"> · {offCount} off</span>
              )}
            </SectionTitle>
            <ul className={cn(SURFACE, "divide-y divide-border/60 overflow-hidden")}>
              {PRIVACY_CONSENT_PURPOSES.map((purpose) => {
                const Icon = PURPOSE_ICONS[purpose]
                const on = isOn(purpose)
                const label = PRIVACY_CONSENT_PURPOSE_LABELS[purpose]
                return (
                  <li key={purpose} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-foreground",
                        !on && "opacity-50",
                      )}
                      aria-hidden
                    >
                      <Icon size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("font-semibold", !on && "text-muted-foreground")}>
                        {label.toLowerCase()}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {PRIVACY_CONSENT_PURPOSE_DESCRIPTIONS[purpose]}
                      </p>
                    </div>
                    {loading ? (
                      <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <Switch
                        on={on}
                        disabled={saving === purpose}
                        label={on ? `Turn off ${label}` : `Turn on ${label}`}
                        onClick={() => void toggle(purpose)}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="space-y-3">
            <SectionTitle>your data</SectionTitle>
            <div className={cn(SURFACE, "p-5 sm:p-6")}>
              <div className="flex flex-wrap items-center gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted">
                  <Download size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">export everything</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    a json archive of your conversations, memories, routines and settings.
                  </p>
                </div>
                <button
                  onClick={() => void requestExport()}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
                >
                  {exporting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Package size={14} />
                  )}
                  {exporting ? "creating…" : "request export"}
                </button>
              </div>
              {exports.length > 0 && (
                <ul className="mt-5 space-y-2">
                  {exports.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4 py-2.5 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        {new Date(row.requestedAt).toLocaleDateString()}
                        <StatusPill status={row.status} />
                      </span>
                      {row.status === "completed" ? (
                        <a
                          href={`/api/privacy/exports/${row.id}`}
                          className="text-xs font-semibold text-[#2b8fff] hover:underline"
                        >
                          view
                        </a>
                      ) : row.error ? (
                        <span className="truncate text-xs text-destructive">{row.error}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <SectionTitle>danger zone</SectionTitle>
            <div className={cn(SURFACE, "divide-y divide-border/60 overflow-hidden")}>
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                    <Trash2 size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">delete my data</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      removes conversations, memories, documents, connected apps, routines and usage
                      history. your account and billing stay.
                    </p>
                  </div>
                  {!confirmDelete && (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="rounded-full bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/15"
                    >
                      delete data
                    </button>
                  )}
                </div>
                {confirmDelete && (
                  <div className="mt-4 rounded-2xl bg-destructive/5 p-4">
                    <p className="text-sm text-destructive">
                      this can&apos;t be undone. everything above is deleted for good.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void deleteData()}
                        disabled={deleting}
                        className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {deleting && <Loader2 size={14} className="animate-spin" />}
                        yes, delete my data
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                )}
                {deleteJobs.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {deleteJobs.map((job) => (
                      <li
                        key={job.id}
                        className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4 py-2.5 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          {new Date(job.requestedAt).toLocaleDateString()}
                          <StatusPill status={job.status} />
                        </span>
                        {job.error && (
                          <span className="truncate text-xs text-destructive">{job.error}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                    <Trash2 size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">delete account</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      cancels your subscription, signs you out everywhere and deletes everything.
                    </p>
                  </div>
                  {!confirmDeleteAccount && (
                    <button
                      onClick={() => setConfirmDeleteAccount(true)}
                      className="rounded-full bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/15"
                    >
                      delete account
                    </button>
                  )}
                </div>
                {confirmDeleteAccount && (
                  <div className="mt-4 space-y-3 rounded-2xl bg-destructive/5 p-4">
                    <p className="text-sm text-destructive">
                      this can&apos;t be undone. type <span className="font-mono">DELETE</span> to
                      confirm.
                    </p>
                    <input
                      type="text"
                      value={deleteAccountText}
                      onChange={(e) => setDeleteAccountText(e.target.value)}
                      placeholder="DELETE"
                      aria-label="Type DELETE to confirm"
                      className="w-full rounded-xl bg-card px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-destructive/50"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void deleteAccount()}
                        disabled={deletingAccount || deleteAccountText !== "DELETE"}
                        className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {deletingAccount && <Loader2 size={14} className="animate-spin" />}
                        delete my account
                      </button>
                      <button
                        onClick={() => {
                          setConfirmDeleteAccount(false)
                          setDeleteAccountText("")
                        }}
                        className="rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="px-1 text-xs text-muted-foreground">
            your data is processed under the DPDP Act 2023. switching something off stops future
            processing; data already stored follows our retention policy until you delete it.
          </p>
        </>
      )}
    </section>
  )
}
