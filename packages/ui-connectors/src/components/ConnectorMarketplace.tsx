"use client"

import { useEffect, useRef, useState } from "react"
import { ConnectorIcon } from "../icons"
import type { ConnectorCategory, ConnectorInfo } from "../types"

// Display names arrive as "Calendar (someone@gmail.com)" — the connector name is
// already the card title, so only the account is worth the width.
export function accountLabel(displayName?: string): string | undefined {
  if (!displayName) return undefined
  const wrapped = displayName.match(/\(([^)]+@[^)]+)\)/)
  return wrapped ? wrapped[1] : displayName
}

interface ConnectorTileProps {
  info: ConnectorInfo
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loading?: boolean
  limitReached?: boolean
  highlighted?: boolean
}

export function ConnectorTile({
  info,
  onConnect,
  onDisconnect,
  loading,
  limitReached,
  highlighted,
}: ConnectorTileProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const tileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlighted && tileRef.current) {
      tileRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [highlighted])

  function handleDisconnectClick() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      return
    }
    onDisconnect(info.id)
    setConfirmDisconnect(false)
  }

  const account = info.connected ? accountLabel(info.displayName) : undefined

  return (
    <div
      ref={tileRef}
      id={`connector-${info.id}`}
      className={[
        "flex flex-col gap-3 rounded-2xl border p-4 transition-colors",
        highlighted
          ? "border-primary ring-2 ring-primary/40 bg-primary/5"
          : "border-border bg-card hover:border-primary/40",
        !info.available ? "opacity-55" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
            <ConnectorIcon id={info.id} size={17} />
          </div>
          <span className="truncate text-sm font-medium text-foreground">{info.name}</span>
        </div>
        {!info.available && (
          <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            Soon
          </span>
        )}
      </div>

      <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{info.description}</p>

      {info.connected && (
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Connected
          </span>
          {account && (
            <span className="truncate text-[11px] text-muted-foreground" title={account}>
              {account}
            </span>
          )}
        </div>
      )}

      {info.available &&
        (info.connected ? (
          <button
            onClick={handleDisconnectClick}
            onMouseLeave={() => setConfirmDisconnect(false)}
            disabled={loading}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:opacity-50"
          >
            {loading ? "Disconnecting..." : confirmDisconnect ? "Confirm?" : "Disconnect"}
          </button>
        ) : limitReached ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            Limit reached — upgrade to connect
          </span>
        ) : (
          <button
            onClick={() => onConnect(info.id)}
            disabled={loading}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {info.authKind === "api_key"
              ? "Add API key"
              : info.authKind === "connection_string"
                ? "Add connection string"
                : "Connect"}
          </button>
        ))}
    </div>
  )
}

const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  productivity: "Productivity",
  "file-storage": "File Storage",
  "file-management": "File Management",
  email: "Email",
  "data-analytics": "Data & Analytics",
  crm: "CRM",
  communication: "Communication",
  developer: "Developer",
  data: "Databases",
  meetings: "Meetings",
  food: "Food",
  finance: "Finance",
  "customer-support": "Customer Support",
  other: "Other",
}

interface ConnectorMarketplaceProps {
  connectors: ConnectorInfo[]
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loadingId?: string | null
  limitReached?: boolean
  highlightId?: string | null
}

export function ConnectorMarketplace({
  connectors,
  onConnect,
  onDisconnect,
  loadingId,
  limitReached,
  highlightId,
}: ConnectorMarketplaceProps) {
  const categories = Array.from(new Set(connectors.map((c) => c.category)))

  return (
    <div className="flex flex-col gap-8">
      {categories.map((category) => {
        const group = connectors.filter((c) => c.category === category)
        const label = CATEGORY_LABELS[category] ?? category
        const connectedCount = group.filter((c) => c.connected).length

        return (
          <div key={category}>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}
              </span>
              {connectedCount > 0 && (
                <span className="text-xs font-medium text-emerald-400">
                  {connectedCount} connected
                </span>
              )}
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((info) => (
                <ConnectorTile
                  key={info.id}
                  info={info}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  loading={loadingId === info.id}
                  limitReached={limitReached && !info.connected}
                  highlighted={highlightId === info.id}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
