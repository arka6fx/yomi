"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowUpRight,
  CheckCircle2,
  Command,
  Copy,
  ListChecks,
  MonitorCog,
  ShieldCheck,
  Terminal,
  Workflow,
} from "lucide-react"

type Connection = { id: string; name: string; healthy?: boolean }

type CommandCenterProps = {
  connections: Connection[]
  onOpenConnections: () => void
}

const RECIPES = [
  {
    title: "Plan my week",
    prompt: "Review my calendar, inbox, and tasks. Suggest a realistic plan and flag conflicts.",
  },
  {
    title: "Research and compare",
    prompt:
      "Research the best options, compare them in a table, and save the shortlist to my Drive.",
  },
  {
    title: "Handle a booking",
    prompt:
      "Find the best flight and hotel options for my trip. Show me the final choice before booking anything.",
  },
]

export function CommandCenter({ connections, onOpenConnections }: CommandCenterProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const healthy = connections.filter((connection) => connection.healthy !== false).length
  const grouped = useMemo(() => connections.slice(0, 8), [connections])

  async function copyPrompt(prompt: string) {
    await navigator.clipboard?.writeText(prompt)
    setCopied(prompt)
    window.setTimeout(() => setCopied(null), 1600)
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Command size={13} /> Personal command center
            </div>
            <h2 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              Give Yomi the whole mission.
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Your connected services and private computer work together as one assistant. Ask for
              an outcome, and Yomi plans the steps, uses the right tools, and pauses before anything
              costly or irreversible.
            </p>
          </div>
          <button
            onClick={onOpenConnections}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Manage connections <ArrowUpRight size={15} />
          </button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Capability
          icon={<Workflow size={18} />}
          title="One tool layer"
          copy="Gmail, Calendar, Drive, Slack, Composio and custom MCP tools appear as one workspace."
        />
        <Capability
          icon={<MonitorCog size={18} />}
          title="Private computer"
          copy="A dedicated desktop for your account can browse, inspect screens, use apps, and run terminal commands."
        />
        <Capability
          icon={<ShieldCheck size={18} />}
          title="Human in the loop"
          copy="Yomi previews purchases, submissions, messages, and destructive actions before they happen."
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Your tool shelf</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {healthy} of {connections.length} connected tools are ready.
              </p>
            </div>
            <button
              onClick={onOpenConnections}
              className="text-xs font-medium text-primary hover:underline"
            >
              Edit
            </button>
          </div>
          {grouped.length ? (
            <div className="flex flex-wrap gap-2">
              {grouped.map((connection) => (
                <span
                  key={connection.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${connection.healthy === false ? "bg-amber-400" : "bg-emerald-400"}`}
                  />
                  {connection.name}
                </span>
              ))}
              {connections.length > grouped.length && (
                <span className="px-2 py-1.5 text-xs text-muted-foreground">
                  +{connections.length - grouped.length} more
                </span>
              )}
            </div>
          ) : (
            <button
              onClick={onOpenConnections}
              className="w-full rounded-xl border border-dashed border-border p-5 text-left text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              Connect your first service to give Yomi useful context.
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Terminal size={17} className="text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Computer workspace</h3>
              <p className="text-xs text-muted-foreground">Dedicated to this account</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 size={13} /> Ready
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Browse in a real browser, work in web apps, or ask Yomi to inspect and edit files from
            the terminal. Sensitive actions still need your approval.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <ListChecks size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Start with a mission</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {RECIPES.map((recipe) => (
            <button
              key={recipe.title}
              onClick={() => void copyPrompt(recipe.prompt)}
              className="group rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_14px_36px_-24px_hsl(var(--primary)/.7)]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium text-foreground">{recipe.title}</span>
                {copied === recipe.prompt ? (
                  <CheckCircle2 size={15} className="text-emerald-400" />
                ) : (
                  <Copy size={15} className="text-muted-foreground group-hover:text-primary" />
                )}
              </div>
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                {recipe.prompt}
              </p>
              <span className="mt-3 block text-[11px] font-medium text-primary">Copy prompt</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function Capability({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-inner">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{copy}</p>
    </div>
  )
}
