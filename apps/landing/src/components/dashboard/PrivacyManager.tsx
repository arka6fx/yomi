"use client"

import { useEffect, useState } from "react"
import { Shield, Check, X, Loader2, Download, Package, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

const CONSENT_LABELS: Record<string, string> = {
  conversation_history: "Conversation History",
  memory: "Memory (Local)",
  cloud_memory: "Cloud Memory (RAG)",
  connector_data: "Connector Data Access",
  analytics: "Analytics",
  voice_processing: "Voice Processing",
  screen_processing: "Screen Processing",
  ai_improvement: "AI Improvement",
  telegram_processing: "Telegram Processing",
  rag_processing: "Document Search (RAG)",
}

const PURPOSE_TO_PREFKEY: Record<string, string> = {
  conversation_history: "conversationHistoryEnabled",
  memory: "memoryEnabled",
  cloud_memory: "cloudMemoryEnabled",
  connector_data: "connectorsEnabled",
  analytics: "analyticsEnabled",
  voice_processing: "voiceProcessingEnabled",
  screen_processing: "screenProcessingEnabled",
  ai_improvement: "aiImprovementEnabled",
  telegram_processing: "telegramProcessingEnabled",
  rag_processing: "ragProcessingEnabled",
}

type ConsentStatus = {
  purpose: string
  status: "granted" | "revoked"
  consentVersion: string
  createdAt: string
}

type Preferences = Partial<Record<string, boolean>>

type ExportRow = {
  id: string
  status: string
  format: string
  error: string | null
  requestedAt: string
  completedAt: string | null
  expiresAt: string | null
}

type TokenProp = { token: string }

export function PrivacyManager({ token }: TokenProp) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [consents, setConsents] = useState<ConsentStatus[]>([])
  const [preferences, setPreferences] = useState<Preferences>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [exports, setExports] = useState<ExportRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteJobs, setDeleteJobs] = useState<ExportRow[]>([])
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deleteAccountText, setDeleteAccountText] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)

  async function fetchOverview() {
    setLoading(true)
    setError(null)
    try {
      const [consentRes, prefRes, exportsRes, deleteRes] = await Promise.all([
        fetch("/api/privacy/consents", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/privacy/preferences", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/privacy/exports", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/privacy/delete-data", { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!consentRes.ok || !prefRes.ok || !exportsRes.ok) {
        throw new Error("Failed to load privacy data")
      }
      const consentData = await consentRes.json()
      const prefData = await prefRes.json()
      const exportsData = await exportsRes.json()
      const deleteData = deleteRes.ok ? await deleteRes.json() : { jobs: [] }
      setConsents(consentData.consents ?? [])
      setPreferences(prefData.preferences ?? {})
      setExports(exportsData.exports ?? [])
      setDeleteJobs(deleteData.jobs ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchOverview()
  }, [token])

  function currentStatus(purpose: string): ConsentStatus | undefined {
    return consents.find((c) => c.purpose === purpose)
  }

  function isGranted(purpose: string): boolean {
    return currentStatus(purpose)?.status === "granted"
  }

  function toggled(purpose: string): boolean {
    return preferences[PURPOSE_TO_PREFKEY[purpose] ?? `${purpose}Enabled`] ?? false
  }

  async function togglePreference(purpose: string) {
    const prefKey = PURPOSE_TO_PREFKEY[purpose] ?? `${purpose}Enabled`
    const newValue = !toggled(purpose)
    setSaving(purpose)
    // Optimistic flip — the round trip (proxy → backend → DB) takes ~1s and the
    // knob shouldn't sit frozen for it. Reverted on failure below.
    setPreferences((prev) => ({ ...prev, [prefKey]: newValue }))
    try {
      const needsConsentSync = newValue ? !isGranted(purpose) : isGranted(purpose)
      const requests: Promise<Response>[] = [
        fetch("/api/privacy/preferences", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ [prefKey]: newValue }),
        }),
      ]
      if (needsConsentSync) {
        requests.push(
          fetch(newValue ? "/api/privacy/consents" : "/api/privacy/consents/revoke", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ purposes: [purpose] }),
          }),
        )
      }
      const responses = await Promise.all(requests)
      if (responses.some((r) => !r.ok)) throw new Error("Failed to update preference")
      // Refresh consent rows in the background — don't block the toggle on it.
      void fetchOverview()
    } catch {
      setPreferences((prev) => ({ ...prev, [prefKey]: !newValue }))
      void fetchOverview()
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">Could not load privacy settings.</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <button
          onClick={() => void fetchOverview()}
          className="mt-4 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <Shield size={18} className="text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Privacy & Consent</h2>
      </div>

      <div className="space-y-3">
        {Object.entries(CONSENT_LABELS).map(([purpose, label]) => {
          const enabled = toggled(purpose)
          return (
            <div
              key={purpose}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => togglePreference(purpose)}
                  disabled={saving === purpose}
                  className="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
                  style={{ backgroundColor: enabled ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
                >
                  <span
                    className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-transform"
                    style={{ transform: enabled ? "translateX(100%)" : "translateX(0)" }}
                  />
                </button>
                <span className="text-sm text-foreground">{label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {saving === purpose ? (
                  <Loader2 size={12} className="animate-spin text-muted-foreground" />
                ) : enabled ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                    <Check size={11} /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <X size={11} /> Off
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <hr className="my-6 border-border" />

      {actionError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-400">{actionError}</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Export Your Data</h3>
        </div>
        <button
          onClick={async () => {
            setExporting(true)
            setActionError(null)
            try {
              const res = await fetch("/api/privacy/exports", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
              })
              if (res.ok) {
                const data = await res.json()
                setExports((prev) => [data.export, ...prev])
              } else {
                setActionError("Export request failed. Please try again.")
              }
            } catch {
              setActionError("Export request failed. Please try again.")
            } finally {
              setExporting(false)
            }
          }}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
          {exporting ? "Creating..." : "Request Export"}
        </button>
      </div>

      {exports.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No exports yet. Request a JSON archive of your data.
        </p>
      ) : (
        <div className="space-y-2">
          {exports.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
            >
              <div>
                <span className="text-xs text-foreground">
                  {new Date(row.requestedAt).toLocaleDateString()}
                </span>
                <span
                  className={cn(
                    "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    row.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : row.status === "failed"
                        ? "bg-red-500/10 text-red-400"
                        : row.status === "processing"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-muted text-muted-foreground",
                  )}
                >
                  {row.status}
                </span>
                {row.error && <span className="ml-2 text-[10px] text-red-400">{row.error}</span>}
              </div>
              <div className="flex items-center gap-2">
                {row.status === "completed" && (
                  <a
                    href={`/api/privacy/exports/${row.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <hr className="my-6 border-border" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trash2 size={16} className="text-red-400" />
          <h3 className="text-sm font-semibold text-foreground">Delete My Data</h3>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Remove all optional product data while keeping your account, subscription, and billing
        records. This deletes conversations, memories, RAG sources, connected services, schedules,
        and usage history.
      </p>

      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          <Trash2 size={12} />
          Delete My Data
        </button>
      ) : (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 space-y-3">
          <p className="text-xs text-red-300">
            This action cannot be undone. All your conversations, memories, RAG sources, connected
            services, schedules, and usage data will be permanently deleted. Your account,
            subscription, and billing records will be preserved.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setDeleting(true)
                setActionError(null)
                try {
                  const res = await fetch("/api/privacy/delete-data", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                  })
                  if (res.ok) {
                    const data = await res.json()
                    setDeleteJobs((prev) => [data.job, ...prev])
                  } else {
                    setActionError("Data deletion failed to start. Please try again.")
                  }
                } catch {
                  setActionError("Data deletion failed to start. Please try again.")
                } finally {
                  setDeleting(false)
                  setConfirmDelete(false)
                }
              }}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {deleting ? "Deleting..." : "Confirm — Delete All My Data"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteJobs.length > 0 && (
        <div className="mt-4 space-y-2">
          {deleteJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
            >
              <div>
                <span className="text-xs text-foreground">
                  {new Date(job.requestedAt).toLocaleDateString()}
                </span>
                <span
                  className={cn(
                    "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    job.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : job.status === "completed_with_errors"
                        ? "bg-amber-500/10 text-amber-400"
                        : job.status === "failed"
                          ? "bg-red-500/10 text-red-400"
                          : job.status === "running"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-muted text-muted-foreground",
                  )}
                >
                  {job.status === "completed_with_errors" ? "completed (with errors)" : job.status}
                </span>
                {job.error && <span className="ml-2 text-[10px] text-red-400">{job.error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <hr className="my-6 border-border" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trash2 size={16} className="text-red-500" />
          <h3 className="text-sm font-semibold text-foreground">Delete Account</h3>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Permanently delete your account and all associated data. Your subscription will be
        cancelled, all sessions will be revoked, and you will be immediately logged out. This action
        cannot be undone.
      </p>

      {!confirmDeleteAccount ? (
        <button
          onClick={() => setConfirmDeleteAccount(true)}
          className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          <Trash2 size={12} />
          Delete Account
        </button>
      ) : (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 space-y-3">
          <p className="text-xs text-red-300">
            This will permanently delete your account and all data. Your subscription will be
            cancelled, you will be logged out of all devices, and you will not be able to log back
            in.
          </p>
          <p className="text-xs text-muted-foreground">
            Type <span className="font-mono text-red-400">DELETE</span> to confirm:
          </p>
          <input
            type="text"
            value={deleteAccountText}
            onChange={(e) => setDeleteAccountText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-red-500/50"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setDeletingAccount(true)
                setActionError(null)
                try {
                  const res = await fetch("/api/privacy/delete-account", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                  })
                  if (res.ok) {
                    window.location.href = "/"
                    return
                  }
                  setActionError("Account deletion failed. Please try again or contact support.")
                } catch {
                  setActionError("Account deletion failed. Please try again or contact support.")
                } finally {
                  setDeletingAccount(false)
                  setConfirmDeleteAccount(false)
                  setDeleteAccountText("")
                }
              }}
              disabled={deletingAccount || deleteAccountText !== "DELETE"}
              className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {deletingAccount ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              {deletingAccount ? "Deleting..." : "Confirm — Delete Account"}
            </button>
            <button
              onClick={() => {
                setConfirmDeleteAccount(false)
                setDeleteAccountText("")
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Your data is processed in accordance with the DPDP Act 2023. You can withdraw consent at any
        time. Revoking consent will stop future processing; historical data is retained per our
        retention policy.
      </p>
    </div>
  )
}
