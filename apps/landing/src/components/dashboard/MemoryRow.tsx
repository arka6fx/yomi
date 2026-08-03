"use client"

import { useState } from "react"
import { Loader2, Pencil, Pin, Trash2, X, Check } from "lucide-react"
import { KINDS, SCOPES, type MemoryRow as MemoryRowData } from "./memory-types"

export function MemoryRow({
  memory,
  forgetting,
  onForget,
  onSave,
}: {
  memory: MemoryRowData
  forgetting: boolean
  onForget: (id: string) => void
  onSave: (
    id: string,
    patch: { topic: string; content: string; kind: string; scope: string },
  ) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draftTopic, setDraftTopic] = useState(memory.topic ?? "")
  const [draftContent, setDraftContent] = useState(memory.content)
  const [draftKind, setDraftKind] = useState<(typeof KINDS)[number]>(
    (memory.kind as (typeof KINDS)[number]) || "fact",
  )
  const [draftScope, setDraftScope] = useState<(typeof SCOPES)[number]>(
    (memory.scope as (typeof SCOPES)[number]) || "global",
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  function startEdit() {
    setDraftTopic(memory.topic ?? "")
    setDraftContent(memory.content)
    setDraftKind((memory.kind as (typeof KINDS)[number]) || "fact")
    setDraftScope((memory.scope as (typeof SCOPES)[number]) || "global")
    setSaveError("")
    setEditing(true)
  }

  async function handleSave() {
    if (!draftContent.trim() || saving) return
    setSaving(true)
    setSaveError("")
    const ok = await onSave(memory.id, {
      topic: draftTopic.trim(),
      content: draftContent.trim(),
      kind: draftKind,
      scope: draftScope,
    })
    setSaving(false)
    if (ok) {
      setEditing(false)
    } else {
      setSaveError("Couldn't save that change")
    }
  }

  if (editing) {
    return (
      <li className="rounded-xl border border-border bg-background/40 px-4 py-3">
        <input
          value={draftTopic}
          onChange={(e) => setDraftTopic(e.target.value)}
          placeholder="Topic (optional)"
          className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
        <textarea
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as (typeof KINDS)[number])}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={draftScope}
            onChange={(e) => setDraftScope(e.target.value as (typeof SCOPES)[number])}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={!draftContent.trim() || saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
        {saveError && <p className="mt-2 text-xs text-destructive">{saveError}</p>}
      </li>
    )
  }

  return (
    <li className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border/80">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {memory.isStatic && <Pin size={11} className="shrink-0 text-primary" />}
          <span className="truncate text-sm font-medium text-foreground">
            {memory.topic || memory.kind || "Memory"}
          </span>
          {memory.kind && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
              {memory.kind.replace("_", " ")}
            </span>
          )}
          {memory.scope && memory.scope !== "global" && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {memory.scope}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {memory.summary || memory.content}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
        <button
          onClick={startEdit}
          aria-label="Edit memory"
          className="rounded-lg p-1.5 text-muted-foreground/60 transition-all hover:bg-primary/10 hover:text-primary"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onForget(memory.id)}
          disabled={forgetting}
          aria-label="Forget memory"
          className="rounded-lg p-1.5 text-muted-foreground/60 transition-all hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {forgetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </li>
  )
}
