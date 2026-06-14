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

export default function IntegrationsPage() {
  const { theme: t } = useContext(ThemeCtx)
  const connectorTheme = useConnectorTheme()

  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)

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

  useEffect(() => {
    void loadIntegrations()
  }, [])

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
    </div>
  )
}
