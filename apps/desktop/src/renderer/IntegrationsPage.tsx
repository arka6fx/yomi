import React, { useEffect, useState, useContext } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useYomiStore } from "./store"
import { ThemeCtx, UI_FONT } from "./theme"

// Gmail icon SVG
function GmailIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4Z" fill="#EAEAEA" />
      <path d="M22 6V8.5L12 14.5L2 8.5V6L12 12L22 6Z" fill="#EA4335" />
      <path d="M2 18V7.5L12 13.5L22 7.5V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18Z" fill="none" />
      <path d="M22 6C22 4.9 21.1 4 20 4H18.5L22 7.5V6Z" fill="#C5221F" />
      <path d="M2 6C2 4.9 2.9 4 4 4H5.5L2 7.5V6Z" fill="#C5221F" />
    </svg>
  )
}

// Notion icon SVG
function NotionIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M4.8 3h14.4c1 0 1.8.8 1.8 1.8v14.4c0 1-.8 1.8-1.8 1.8H4.8C3.8 21 3 20.2 3 19.2V4.8C3 3.8 3.8 3 4.8 3zm2.7 3.6h1.8v8.4l4.5-8.4h1.8v10.8h-1.8V7.8l-4.5 8.4H7.5V6.6z" fill="#CCCCCC" />
    </svg>
  )
}

// Slack icon SVG
function SlackIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523 2.528 2.528 0 0 1-2.522-2.523 2.528 2.528 0 0 1 2.522-2.52h2.52v2.52zM6.302 15.165a2.528 2.528 0 0 1 2.52-2.52h5.044a2.528 2.528 0 0 1 2.522 2.52v5.043a2.528 2.528 0 0 1-2.522 2.52H8.822a2.528 2.528 0 0 1-2.52-2.52v-5.043zM8.822 5.043a2.528 2.528 0 0 1 2.52-2.522 2.528 2.528 0 0 1 2.522 2.522v2.52h-2.522a2.528 2.528 0 0 1-2.52-2.52zM8.822 6.303a2.528 2.528 0 0 1 2.52 2.52v5.044a2.528 2.528 0 0 1-2.52 2.522H3.778a2.528 2.528 0 0 1-2.522-2.522 2.528 2.528 0 0 1 2.522-2.52h5.044zM18.958 8.823a2.528 2.528 0 0 1 2.52-2.52 2.528 2.528 0 0 1 2.522 2.52 2.528 2.528 0 0 1-2.522 2.52h-2.52v-2.52zM17.698 8.823a2.528 2.528 0 0 1-2.52 2.52h-5.044a2.528 2.528 0 0 1-2.522-2.52V3.78a2.528 2.528 0 0 1 2.522-2.52h5.044a2.528 2.528 0 0 1 2.52 2.52v5.043zM15.178 18.957a2.528 2.528 0 0 1-2.52 2.522 2.528 2.528 0 0 1-2.522-2.522v-2.52h2.522a2.528 2.528 0 0 1 2.52 2.52zM15.178 17.697a2.528 2.528 0 0 1-2.52-2.52v-5.044a2.528 2.528 0 0 1 2.52-2.522h5.044a2.528 2.528 0 0 1 2.522 2.522 2.528 2.528 0 0 1-2.522 2.52h-5.044z" fill="#36C5F0" />
    </svg>
  )
}

// GitHub icon SVG
function GitHubIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.164 22 16.416 22 12c0-5.523-4.477-10-10-10z" fill="#CCCCCC" />
    </svg>
  )
}

function getProviderIcon(provider: string, size = 28) {
  switch (provider.toLowerCase()) {
    case "google":
    case "gmail":
      return <GmailIcon size={size} />
    case "notion":
      return <NotionIcon size={size} />
    case "slack":
      return <SlackIcon size={size} />
    case "github":
      return <GitHubIcon size={size} />
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#CCCCCC" strokeWidth="2" />
        </svg>
      )
  }
}

interface ConnectedCardProps {
  integration: {
    id: string
    provider: string
    displayName: string
    scopes: string[]
    lastSyncAt: string | null
  }
  theme: any
  onDisconnect: (provider: string) => Promise<void>
}

function ConnectedCard({ integration, theme: t, onDisconnect }: ConnectedCardProps) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleDisconnect = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setLoading(true)
    try {
      await onDisconnect(integration.provider)
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  const formatRelativeTime = (isoString: string | null) => {
    if (!isoString) return "Not synced yet"
    const ms = Date.now() - new Date(isoString).getTime()
    const mins = Math.round(ms / 60000)
    if (mins < 1) return "just now"
    if (mins === 1) return "1 min ago"
    if (mins < 60) return `${mins} mins ago`
    const hours = Math.round(mins / 60)
    if (hours === 1) return "1 hour ago"
    if (hours < 24) return `${hours} hours ago`
    return new Date(isoString).toLocaleDateString()
  }

  return (
    <motion.div
      layout
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 8,
            background: t.btnHoverBg,
            border: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {getProviderIcon(integration.provider, 24)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
              {integration.provider === "google" ? "Google Gmail" : integration.displayName}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                borderRadius: 99,
                padding: "2px 8px",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#10B981",
                  boxShadow: "0 0 6px #10B981",
                }}
              />
              <span style={{ fontSize: 9, fontWeight: 600, color: "#10B981", textTransform: "uppercase" }}>
                Connected
              </span>
            </span>
          </div>
          <div style={{ fontSize: 11, color: t.dim, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
              {integration.displayName}
            </span>
            <span style={{ fontSize: 10, opacity: 0.75 }}>
              Sync: {formatRelativeTime(integration.lastSyncAt)}
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={handleDisconnect}
        disabled={loading}
        onMouseLeave={() => setConfirming(false)}
        style={{
          fontFamily: UI_FONT,
          fontSize: confirming ? 10 : 11,
          fontWeight: 600,
          color: confirming ? t.error : t.dangerText,
          background: confirming ? t.errorD : "transparent",
          border: `1px solid ${confirming ? t.error : t.border}`,
          borderRadius: 6,
          padding: confirming ? "4px 8px" : "6px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "Disconnecting..." : confirming ? "Confirm?" : "Disconnect"}
      </button>
    </motion.div>
  )
}

interface AvailableCardProps {
  provider: {
    id: string
    name: string
    description: string
    category: string
    comingSoon?: boolean
  }
  theme: any
  onConnect: (provider: string) => void
}

function AvailableCard({ provider, theme: t, onConnect }: AvailableCardProps) {
  return (
    <motion.div
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        opacity: provider.comingSoon ? 0.6 : 1,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
        position: "relative",
      }}
      whileHover={provider.comingSoon ? {} : { translateY: -2, borderColor: t.borderHi }}
      transition={{ duration: 0.2 }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: t.btnHoverBg,
            border: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {getProviderIcon(provider.id, 22)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{provider.name}</span>
            {provider.comingSoon && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: t.dim,
                  background: t.btnHoverBg,
                  border: `1px solid ${t.border}`,
                  padding: "1px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                }}
              >
                Soon
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: t.dim, marginTop: 4, lineHeight: 1.4, margin: 0 }}>
            {provider.description}
          </p>
        </div>
      </div>

      {!provider.comingSoon && (
        <button
          onClick={() => onConnect(provider.id)}
          style={{
            width: "100%",
            fontFamily: UI_FONT,
            fontSize: 11,
            fontWeight: 600,
            color: t.btnHoverText,
            background: t.btnHoverBg,
            border: `1px solid ${t.border}`,
            borderRadius: 6,
            padding: "6px 0",
            cursor: "pointer",
            transition: "all 0.2s ease",
            marginTop: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = t.accentD
            e.currentTarget.style.borderColor = t.accent
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = t.btnHoverBg
            e.currentTarget.style.borderColor = t.border
          }}
        >
          Connect
        </button>
      )}
    </motion.div>
  )
}

const AVAILABLE_PROVIDERS = [
  {
    id: "google",
    name: "Google Gmail",
    description: "Read, search, summarize and send emails through your Gmail account securely via OAuth.",
    category: "Communication",
    comingSoon: false,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Connect your Notion workspace to search, read, and write pages directly from Yomi.",
    category: "Productivity",
    comingSoon: true,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Connect channels and send messages directly to your Slack team members.",
    category: "Communication",
    comingSoon: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repositories, read issues, review PRs and automate developer workflows.",
    category: "Development",
    comingSoon: true,
  },
]

export default function IntegrationsPage() {
  const { theme: t } = useContext(ThemeCtx)
  const integrations = useYomiStore((s) => s.integrations)
  const loading = useYomiStore((s) => s.integrationsLoading)
  const loadIntegrations = useYomiStore((s) => s.loadIntegrations)
  const disconnectIntegration = useYomiStore((s) => s.disconnectIntegration)

  useEffect(() => {
    void loadIntegrations()
  }, [loadIntegrations])

  const connectedList = integrations.filter((i) => i.connected)
  const connectedIds = new Set(connectedList.map((i) => i.provider))

  const handleConnect = (providerId: string) => {
    window.yomi.connectIntegration(providerId)
  }

  const sectionLabel = (text: string) => (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        fontWeight: 700,
        color: t.sectionLabel,
        marginBottom: 10,
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span>{text}</span>
      <span style={{ flex: 1, height: 1, background: t.border }} />
    </div>
  )

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "16px",
        height: "100%",
        boxSizing: "border-box",
        overflowY: "auto",
        fontFamily: UI_FONT,
        background: t.bg,
      }}
      className="custom-scrollbar"
    >
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: t.text, margin: 0 }}>Integrations</h2>
        <p style={{ fontSize: 11.5, color: t.dim, margin: "4px 0 0 0", lineHeight: 1.45 }}>
          Connect Yomi directly to your everyday tools. Your authorization credentials are fully encrypted and stored locally.
        </p>
      </div>

      {loading && integrations.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            color: t.dim,
            fontSize: 12,
            minHeight: 180,
          }}
        >
          <span style={{ marginRight: 8 }}>⋯</span> Loading your integrations...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Connected section */}
          {connectedList.length > 0 && (
            <div>
              {sectionLabel("Your Connected Services")}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {connectedList.map((integration) => (
                  <ConnectedCard
                    key={integration.id}
                    integration={integration}
                    theme={t}
                    onDisconnect={disconnectIntegration}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Available section */}
          <div>
            {sectionLabel("Available Integrations")}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              {AVAILABLE_PROVIDERS.map((provider) => {
                // If already connected, skip showing it in available or keep it styled appropriately
                if (connectedIds.has(provider.id)) return null
                return (
                  <AvailableCard
                    key={provider.id}
                    provider={provider}
                    theme={t}
                    onConnect={handleConnect}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
