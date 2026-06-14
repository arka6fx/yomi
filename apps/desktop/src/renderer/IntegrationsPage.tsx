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

const BOT_META: Record<string, { name: string; color: string }> = {
  telegram: { name: "Telegram", color: "#3aa9e0" },
  discord: { name: "Discord", color: "#7a8cf0" },
}

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

  async function handleBotConnect(platform: "telegram" | "discord") {
    setBotBusy(platform)
    try {
      const result =
        platform === "telegram"
          ? await window.yomi.connectTelegramBot()
          : await window.yomi.connectDiscordBot()
      if (result.error) console.error("[bot] connect error:", result.error)
      // Browser opened for linking; refresh shortly after the user returns
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
  const connectedMap = Object.fromEntries(
    integrations.map((i) => [i.provider, i.displayName]),
  )
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
          Connect Yomi to your tools. Query them from the desktop or Telegram with your desktop closed.
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

      {/* Bot channels — chat with Yomi from Telegram or Discord */}
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
          Connect Telegram or Discord to message Yomi even with your desktop closed.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(["telegram", "discord"] as const).map((platform) => {
            const meta = BOT_META[platform] ?? { name: platform, color: t.dim as string }
            const connected = connectedBots.has(platform)
            const conn = botConnections.find((b) => b.platform === platform)
            const busy = botBusy === platform
            return (
              <div
                key={platform}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${t.border}`,
                  background: t.surface,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: meta.color,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>{meta.name}</div>
                    <div style={{ fontSize: 10.5, color: t.dim }}>
                      {connected && conn
                        ? `Connected ${new Date(conn.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : "Not connected"}
                    </div>
                  </div>
                </div>

                {connected ? (
                  <button
                    onClick={() => void handleBotUnlink(platform)}
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
                ) : (
                  <button
                    onClick={() => void handleBotConnect(platform)}
                    disabled={busy}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: connectorTheme.accentText,
                      background: connectorTheme.accent,
                      border: "none",
                      borderRadius: 8,
                      padding: "5px 12px",
                      cursor: busy ? "default" : "pointer",
                      opacity: busy ? 0.5 : 1,
                      fontFamily: UI_FONT,
                    }}
                  >
                    {busy ? "Opening…" : "Connect"}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
