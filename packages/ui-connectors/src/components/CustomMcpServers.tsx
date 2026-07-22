"use client"

import { useState, type FormEvent } from "react"

export interface CustomMcpServerInfo {
  id: string
  name: string
  url: string
}

function PlugIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary"
    >
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v3a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  )
}

export function CustomMcpServers({
  servers,
  onAdd,
  onDelete,
  adding,
  addError,
}: {
  servers: CustomMcpServerInfo[]
  onAdd: (input: { name: string; url: string; apiKey: string }) => void
  onDelete: (id: string) => void
  adding?: boolean
  addError?: string
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    onAdd({ name: name.trim(), url: url.trim(), apiKey: apiKey.trim() })
    setName("")
    setUrl("")
    setApiKey("")
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
          <PlugIcon size={16} />
        </div>
        <h2 className="text-sm font-medium text-foreground">Custom MCP servers</h2>
      </div>

      {servers.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.url}</p>
              </div>
              <button
                onClick={() => onDelete(s.id)}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Integration name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My internal tools"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Server URL
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
            API key <span className="normal-case text-muted-foreground/70">(optional)</span>
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave empty if the server doesn't require auth"
            className={inputClass}
          />
        </div>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
        <button
          type="submit"
          disabled={adding}
          className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {adding ? "Connecting..." : "Connect"}
        </button>
      </form>
    </div>
  )
}
