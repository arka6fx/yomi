import React, { useEffect, useState, useContext } from "react"
import { motion } from "framer-motion"
import { ThemeCtx, UI_FONT } from "./theme"
import { ConnectorMarketplace, buildCatalog } from "@yomi/ui-connectors"
import type { ConnectorTheme } from "@yomi/ui-connectors"

function useConnectorTheme(): ConnectorTheme {
  const { theme: t } = useContext(ThemeCtx)
  return {
    bg: t.bg as string,
    surface: t.surface as string,
    border: t.border as string,
    borderHi: (t.borderHi as string | undefined) ?? "rgba(255,255,255,0.18)",
    text: t.text as string,
    dim: t.dim as string,
    accent: (t.accent as string | undefined) ?? "#e07b39",
    accentText: "#fff",
    error: (t.error as string | undefined) ?? "#e5534b",
    successBg: "rgba(16,185,129,0.1)",
    successBorder: "rgba(16,185,129,0.2)",
    successText: "#10B981",
    btnBg: (t.btnHoverBg as string | undefined) ?? "rgba(255,255,255,0.06)",
    btnText: (t.btnHoverText as string | undefined) ?? "#ccc",
    font: UI_FONT,
  }
}

type Integration = {
  id: string
  provider: string
  displayName: string
  scopes: string[]
  connected: boolean
  lastSyncAt: string | null
}

type BotConnection = { platform: string; connectedAt: string }

const TELEGRAM_COLOR = "#3aa9e0"

export default function IntegrationsPage() {
  const { theme: t } = useContext(ThemeCtx)
  const connectorTheme = useConnectorTheme()

  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const [botConnections, setBotConnections] = useState<BotConnection[]>([])
  const [botBusy, setBotBusy] = useState<string | null>(null)

  async function loadIntegrations() {
    setLoading(true)
    try {
      const rows = await window.yomi.getIntegrations()
      setIntegrations(rows)
    } catch {
      // best-effort
    } finally {
      setLoading(false)
    }
  }

  async function loadBotConnections() {
    try {
      const rows = await window.yomi.getBotConnections()
      setBotConnections(Array.isArray(rows) ? rows : [])
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    void loadIntegrations()
    void loadBotConnections()
  }, [])

  async function handleBotConnect(platform: "telegram") {
    setBotBusy(platform)
    try {
      const result = await window.yomi.connectTelegramBot()
      if (result.error) console.error("[bot] connect error:", result.error)
      setTimeout(() => void loadBotConnections(), 3000)
    } finally {
      setBotBusy(null)
    }
  }

  async function handleBotUnlink(platform: string) {
    setBotBusy(platform)
    try {
      await window.yomi.unlinkBot(platform)
      setBotConnections((prev) => prev.filter((b) => b.platform !== platform))
    } catch {
      // best-effort
    } finally {
      setBotBusy(null)
    }
  }

  const connectedBots = new Set(botConnections.map((b) => b.platform))

  const connectedProviders = integrations.map((i) => i.provider)
  const connectedMap = Object.fromEntries(integrations.map((i) => [i.provider, i.displayName]))
  const catalog = buildCatalog(connectedProviders).map((c) => ({
    ...c,
    displayName: connectedMap[c.id],
  }))

  async function handleConnect(id: string) {
    const result = await window.yomi.connectIntegration(id)
    if (result.error) {
      console.error("[integrations] connect error:", result.error)
    }
    // For oauth2: browser opened; for api_key/dsn: would need a modal (future)
    // Reload after a short delay so connected state updates after browser callback
    setTimeout(() => void loadIntegrations(), 2000)
  }

  async function handleDisconnect(id: string) {
    setLoadingId(id)
    try {
      await window.yomi.disconnectIntegration(id)
      setIntegrations((prev) => prev.filter((i) => i.provider !== id))
    } catch {
      // best-effort
    } finally {
      setLoadingId(null)
    }
  }

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
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: 20 }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: t.text, margin: 0 }}>Integrations</h2>
        <p style={{ fontSize: 11.5, color: t.dim, margin: "4px 0 0 0", lineHeight: 1.45 }}>
          Connect Yomi to your tools. Query them from the desktop or Telegram with your desktop
          closed.
        </p>
      </motion.div>

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
          <span style={{ marginRight: 8 }}>⋯</span> Loading...
        </div>
      ) : (
        <ConnectorMarketplace
          connectors={catalog}
          theme={connectorTheme}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          loadingId={loadingId}
        />
      )}

      {/* Telegram — chat with Yomi from anywhere */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        style={{ marginTop: 24 }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: t.text, margin: "0 0 2px 0" }}>
          Chat from anywhere
        </h3>
        <p style={{ fontSize: 11, color: t.dim, margin: "0 0 12px 0", lineHeight: 1.45 }}>
          Link Telegram to message Yomi on your phone, even with your laptop closed.
        </p>

        {(() => {
          const connected = connectedBots.has("telegram")
          const conn = botConnections.find((b) => b.platform === "telegram")
          const busy = botBusy === "telegram"

          if (connected && conn) {
            return (
              <div
                style={{
                  borderRadius: 12,
                  border: `1px solid ${t.border}`,
                  background: t.surface,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: TELEGRAM_COLOR,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${TELEGRAM_COLOR}80`,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>Telegram</div>
                      <div style={{ fontSize: 10.5, color: connectorTheme.successText }}>
                        Connected{" "}
                        {new Date(conn.connectedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleBotUnlink("telegram")}
                    disabled={busy}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: connectorTheme.error,
                      background: "transparent",
                      border: `1px solid ${t.border}`,
                      borderRadius: 8,
                      padding: "5px 12px",
                      cursor: busy ? "default" : "pointer",
                      opacity: busy ? 0.5 : 1,
                      fontFamily: UI_FONT,
                    }}
                  >
                    {busy ? "…" : "Unlink"}
                  </button>
                </div>
                <div
                  style={{
                    borderTop: `1px solid ${t.border}`,
                    padding: "8px 14px",
                    fontSize: 10.5,
                    color: t.dim,
                    lineHeight: 1.5,
                  }}
                >
                  Try sending{" "}
                  <span style={{ fontFamily: "monospace", color: t.text }}>analyze my screen</span>{" "}
                  while the app is open, or ask about your files and tasks anytime.
                </div>
              </div>
            )
          }

          return (
            <div
              style={{
                borderRadius: 12,
                border: `1px solid ${t.border}`,
                background: t.surface,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "14px 14px 12px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: t.dim as string,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>Telegram</div>
                  </div>
                  <button
                    onClick={() => void handleBotConnect("telegram")}
                    disabled={busy}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: connectorTheme.accentText,
                      background: TELEGRAM_COLOR,
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 14px",
                      cursor: busy ? "default" : "pointer",
                      opacity: busy ? 0.5 : 1,
                      fontFamily: UI_FONT,
                    }}
                  >
                    {busy ? "Opening Telegram…" : "Connect Telegram"}
                  </button>
                </div>

                {/* Step guide */}
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {[
                    { n: "1", label: "Click Connect Telegram above" },
                    { n: "2", label: "Telegram opens with the Yomi bot" },
                    { n: "3", label: "Press Start — you're linked" },
                  ].map(({ n, label }) => (
                    <div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: `1px solid ${t.border}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 700,
                          color: t.dim,
                          flexShrink: 0,
                        }}
                      >
                        {n}
                      </span>
                      <span style={{ fontSize: 11, color: t.dim, lineHeight: 1.4 }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
      </motion.div>
    </div>
  )
}
