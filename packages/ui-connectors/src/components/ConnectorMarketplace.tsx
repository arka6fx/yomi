"use client"

import React, { useEffect, useRef, useState } from "react"
import { ConnectorIcon } from "../icons"
import { DARK_THEME } from "../types"
import type { ConnectorCategory, ConnectorInfo, ConnectorTheme } from "../types"

interface ConnectedBadgeProps {
  t: ConnectorTheme
}

function ConnectedBadge({ t }: ConnectedBadgeProps) {
  return (
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
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: t.successText,
          textTransform: "uppercase" as const,
        }}
      >
        Connected
      </span>
    </span>
  )
}

// Display names arrive as "Calendar (someone@gmail.com)" — the connector name is
// already the card title, so only the account is worth the width.
export function accountLabel(displayName?: string): string | undefined {
  if (!displayName) return undefined
  const wrapped = displayName.match(/\(([^)]+@[^)]+)\)/)
  return wrapped ? wrapped[1] : displayName
}

function AccountLine({ t, displayName }: { t: ConnectorTheme; displayName?: string }) {
  const account = accountLabel(displayName)
  if (!account) return null
  return (
    <p
      title={account}
      style={{
        fontSize: 11,
        color: t.dim,
        margin: "3px 0 0 0",
        fontFamily: t.font,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap" as const,
      }}
    >
      {account}
    </p>
  )
}

interface ConnectorTileProps {
  info: ConnectorInfo
  t: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loading?: boolean
  limitReached?: boolean
  highlighted?: boolean
}

export function ConnectorTile({
  info,
  t,
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

  return (
    <div
      ref={tileRef}
      id={`connector-${info.id}`}
      onMouseEnter={(e) => {
        if (info.available) e.currentTarget.style.borderColor = t.borderHi
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = highlighted ? t.accent : "transparent"
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 8px",
        borderRadius: 10,
        border: "1px solid transparent",
        borderBottom: `1px solid ${t.border}`,
        ...(highlighted
          ? {
              borderColor: t.accent,
              boxShadow: `0 0 0 2px ${t.accent}40`,
              background: `${t.accent}0d`,
            }
          : {}),
        opacity: !info.available ? 0.55 : 1,
        boxSizing: "border-box" as const,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: t.btnBg,
          border: `1px solid ${t.borderHi}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <ConnectorIcon id={info.id} size={17} />
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" as const }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: t.text,
              fontFamily: t.font,
              flexShrink: 0,
            }}
          >
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
                flexShrink: 0,
              }}
            >
              Soon
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color: t.dim,
              fontFamily: t.font,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap" as const,
              minWidth: 0,
            }}
          >
            {info.description}
          </span>
        </div>
        {info.connected && <AccountLine t={t} displayName={info.displayName} />}
      </div>

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        {info.connected && <ConnectedBadge t={t} />}
        {info.available &&
          (info.connected ? (
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
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: confirmDisconnect ? t.accent : t.dim,
                background: "transparent",
                border: `1px solid ${confirmDisconnect ? t.accent : t.border}`,
                borderRadius: 6,
                padding: "4px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap" as const,
              }}
            >
              {loading ? "Disconnecting..." : confirmDisconnect ? "Confirm?" : "Disconnect"}
            </button>
          ) : limitReached ? (
            <span
              style={{
                fontFamily: t.font,
                fontSize: 10,
                fontWeight: 600,
                color: t.dim,
                whiteSpace: "nowrap" as const,
              }}
            >
              Limit reached — upgrade to connect
            </span>
          ) : (
            <button
              onClick={() => onConnect(info.id)}
              disabled={loading}
              style={{
                fontFamily: t.font,
                fontSize: 11,
                fontWeight: 600,
                color: t.btnText,
                background: t.btnBg,
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "4px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap" as const,
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
          ))}
      </div>
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
  theme?: ConnectorTheme
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  loadingId?: string | null
  limitReached?: boolean
  highlightId?: string | null
}

export function ConnectorMarketplace({
  connectors,
  theme: t = DARK_THEME,
  onConnect,
  onDisconnect,
  loadingId,
  limitReached,
  highlightId,
}: ConnectorMarketplaceProps) {
  const categories = Array.from(new Set(connectors.map((c) => c.category)))

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
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: t.successText,
                    fontFamily: t.font,
                  }}
                >
                  {connectedCount} connected
                </span>
              )}
              <span style={{ flex: 1, height: 1, background: t.borderHi }} />
            </div>
            <div>
              {group.map((info) => (
                <ConnectorTile
                  key={info.id}
                  info={info}
                  t={t}
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
