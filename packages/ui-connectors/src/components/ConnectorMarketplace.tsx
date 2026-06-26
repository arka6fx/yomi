"use client"

import React, { useState } from "react"
import { ConnectorIcon } from "../icons"
import { DARK_THEME } from "../types"
import type { ConnectorInfo, ConnectorTheme } from "../types"

interface ConnectedBadgeProps {
  t: ConnectorTheme
  displayName?: string
}

function ConnectedBadge({ t, displayName }: ConnectedBadgeProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: t.successBg,
          border: `1px solid ${t.successBorder}`,
          borderRadius: 99,
          padding: "2px 8px",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: t.successText,
            boxShadow: `0 0 6px ${t.successText}`,
          }}
        />
        <span style={{ fontSize: 9, fontWeight: 600, color: t.successText, textTransform: "uppercase" as const }}>
          Connected
        </span>
      </span>
      {displayName && (
        <span style={{ fontSize: 10, color: t.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 120 }}>
          {displayName}
        </span>
      )}
    </div>
  )
}

interface ConnectorTileProps {
  info: ConnectorInfo
  t: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loading?: boolean
  limitReached?: boolean
}

export function ConnectorTile({ info, t, onConnect, onDisconnect, loading, limitReached }: ConnectorTileProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  function handleDisconnectClick() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      return
    }
    onDisconnect(info.id)
    setConfirmDisconnect(false)
  }

  return (
    <div
      onMouseEnter={(e) => {
        if (info.available) e.currentTarget.style.borderColor = t.borderHi
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = t.border
      }}
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column" as const,
        gap: 14,
        opacity: !info.available ? 0.55 : 1,
        boxSizing: "border-box" as const,
        backdropFilter: t.backdropFilter,
        WebkitBackdropFilter: t.backdropFilter,
        boxShadow: t.cardShadow,
        transition: "border-color 0.15s ease",
      }}
    >
      {/* Icon + name row */}
      <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: t.btnBg,
            border: `1px solid ${t.borderHi}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ConnectorIcon id={info.id} size={23} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: t.text, fontFamily: t.font }}>
              {info.name}
            </span>
            {!info.available && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: t.dim,
                  background: t.btnBg,
                  border: `1px solid ${t.border}`,
                  padding: "1px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase" as const,
                }}
              >
                Soon
              </span>
            )}
            {info.connected && <ConnectedBadge t={t} displayName={info.displayName} />}
          </div>
          <p style={{ fontSize: 12, color: t.dim, lineHeight: 1.5, margin: "5px 0 0 0", fontFamily: t.font }}>
            {info.description}
          </p>
        </div>
      </div>

      {/* Action button */}
      {info.available && (
        <div style={{ marginTop: "auto" }}>
          {info.connected ? (
            <button
              onClick={handleDisconnectClick}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = t.accent
                e.currentTarget.style.borderColor = t.accent
              }}
              onMouseLeave={(e) => {
                setConfirmDisconnect(false)
                e.currentTarget.style.color = t.dim
                e.currentTarget.style.borderColor = t.border
              }}
              disabled={loading}
              style={{
                width: "100%",
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: confirmDisconnect ? t.accent : t.dim,
                background: "transparent",
                border: `1px solid ${confirmDisconnect ? t.accent : t.border}`,
                borderRadius: 6,
                padding: "6px 0",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {loading ? "Disconnecting..." : confirmDisconnect ? "Confirm disconnect?" : "Disconnect"}
            </button>
          ) : limitReached ? (
            <div
              style={{
                width: "100%",
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: t.dim,
                background: "transparent",
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "6px 0",
                textAlign: "center" as const,
                boxSizing: "border-box" as const,
              }}
            >
              Limit reached. Upgrade to connect
            </div>
          ) : (
            <button
              onClick={() => onConnect(info.id)}
              disabled={loading}
              style={{
                width: "100%",
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: t.btnText,
                background: t.btnBg,
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "6px 0",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = t.accent
                e.currentTarget.style.color = t.accentText
                e.currentTarget.style.borderColor = t.accent
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = t.btnBg
                e.currentTarget.style.color = t.btnText
                e.currentTarget.style.borderColor = t.border
              }}
            >
              {info.authKind === "api_key"
                ? "Add API key"
                : info.authKind === "connection_string"
                  ? "Add connection string"
                  : "Connect"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const CATEGORY_LABELS: Record<string, string> = {
  email: "Email",
  productivity: "Productivity",
  "file-storage": "File Storage",
  engineering: "Engineering",
  knowledge: "Knowledge",
  "data-analytics": "Data & Analytics",
  data: "Databases",
  crm: "CRM",
  support: "Support",
  finance: "Finance",
  design: "Design",
  security: "Security",
  hr: "HR",
  meetings: "Meetings",
  developer: "Developer",
  communication: "Communication",
}

interface ConnectorMarketplaceProps {
  connectors: ConnectorInfo[]
  theme?: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loadingId?: string | null
  limitReached?: boolean
}

export function ConnectorMarketplace({
  connectors,
  theme: t = DARK_THEME,
  onConnect,
  onDisconnect,
  loadingId,
  limitReached,
}: ConnectorMarketplaceProps) {
  const categories = Array.from(
    new Set(connectors.map((c) => c.category)),
  )

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 32 }}>
      {categories.map((category) => {
        const group = connectors.filter((c) => c.category === category)
        const label = CATEGORY_LABELS[category] ?? category
        const connectedCount = group.filter((c) => c.connected).length

        return (
          <div key={category}>
            <div
              style={{
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  fontWeight: 700,
                  color: t.dim,
                  textTransform: "uppercase" as const,
                  fontFamily: t.font,
                }}
              >
                {label}
              </span>
              {connectedCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: t.successText, fontFamily: t.font }}>
                  {connectedCount} connected
                </span>
              )}
              <span style={{ flex: 1, height: 1, background: t.borderHi }} />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))",
                gap: 14,
              }}
            >
              {group.map((info) => (
                <ConnectorTile
                  key={info.id}
                  info={info}
                  t={t}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  loading={loadingId === info.id}
                  limitReached={limitReached && !info.connected}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
