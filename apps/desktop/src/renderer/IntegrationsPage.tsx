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

type DriveSource = {
  id: string
  name: string
  folderId: string
  status: string
  syncState: { filesIndexed: number; filesSkipped: number; lastSyncedAt: string | null }
}

type Suggestion = {
  dedupKey: string
  title: string
  description: string
  schedulePreview: string
}

const TELEGRAM_COLOR = "#3aa9e0"

export default function IntegrationsPage() {
  const { theme: t } = useContext(ThemeCtx)
  const connectorTheme = useConnectorTheme()

  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const [botConnections, setBotConnections] = useState<BotConnection[]>([])
  const [botBusy, setBotBusy] = useState<string | null>(null)

  const [driveSources, setDriveSources] = useState<DriveSource[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [driveFolderId, setDriveFolderId] = useState("")
  const [driveName, setDriveName] = useState("")
  const [driveAdding, setDriveAdding] = useState(false)
  const [driveRemovingId, setDriveRemovingId] = useState<string | null>(null)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [suggestionBusyKey, setSuggestionBusyKey] = useState<string | null>(null)
  const [suggestionEnabledKey, setSuggestionEnabledKey] = useState<string | null>(null)

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

  async function loadDriveSources() {
    setDriveLoading(true)
    try {
      const result = await window.yomi.getDriveSources()
      if (result.error) {
        setDriveError(
          result.code === "upgrade_required" ? "Indexing folders requires Pro" : result.error,
        )
        return
      }
      setDriveSources(result.sources ?? [])
      setDriveError(null)
    } catch {
      // best-effort
    } finally {
      setDriveLoading(false)
    }
  }

  async function loadSuggestions() {
    try {
      const result = await window.yomi.getSuggestions()
      if (result.error) return
      setSuggestions(result.suggestions ?? [])
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    void loadIntegrations()
    void loadBotConnections()
    void loadSuggestions()
  }, [])

  const driveConnected = integrations.some((i) => i.provider === "google-drive" && i.connected)

  useEffect(() => {
    if (driveConnected) void loadDriveSources()
  }, [driveConnected])

  // Refresh offers when the set of connected providers changes
  const connectedKey = integrations
    .filter((i) => i.connected)
    .map((i) => i.provider)
    .sort()
    .join(",")

  useEffect(() => {
    void loadSuggestions()
  }, [connectedKey])

  async function handleAddDriveSource() {
    const folderId = driveFolderId.trim()
    if (!folderId) {
      setDriveError("Enter a folder ID")
      return
    }
    setDriveAdding(true)
    setDriveError(null)
    try {
      const result = await window.yomi.createDriveSource({
        folderId,
        name: driveName.trim() || undefined,
      })
      if (result.error) {
        setDriveError(
          result.code === "upgrade_required"
            ? "Indexing folders requires Pro"
            : result.code === "invalid_folder"
              ? "Enter a folder ID"
              : result.error,
        )
        return
      }
      setDriveFolderId("")
      setDriveName("")
      await loadDriveSources()
    } finally {
      setDriveAdding(false)
    }
  }

  async function handleRemoveDriveSource(id: string) {
    setDriveRemovingId(id)
    try {
      const result = await window.yomi.deleteDriveSource(id)
      if (result.error) {
        setDriveError(result.error)
        return
      }
      await loadDriveSources()
    } finally {
      setDriveRemovingId(null)
    }
  }

  async function handleAcceptSuggestion(dedupKey: string) {
    setSuggestionBusyKey(dedupKey)
    setSuggestionError(null)
    try {
      const result = await window.yomi.acceptSuggestion(dedupKey)
      if (result.error) {
        if (result.code === "schedule_limit" || result.code === "feature_not_available") {
          setSuggestionError("Schedule limit reached for your plan")
        } else if (result.code === "not_offerable" || result.code === "already_decided") {
          await loadSuggestions()
        } else {
          setSuggestionError(result.error)
        }
        return
      }
      setSuggestionEnabledKey(dedupKey)
      setTimeout(() => {
        setSuggestionEnabledKey(null)
        void loadSuggestions()
      }, 1200)
    } finally {
      setSuggestionBusyKey(null)
    }
  }

  async function handleDismissSuggestion(dedupKey: string) {
    setSuggestionBusyKey(dedupKey)
    try {
      await window.yomi.dismissSuggestion(dedupKey)
      await loadSuggestions()
    } catch {
      // best-effort
    } finally {
      setSuggestionBusyKey(null)
    }
  }

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

      {/* Indexed folders — Drive folders synced into RAG */}
      {driveConnected && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          style={{ marginTop: 24 }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 700, color: t.text, margin: "0 0 2px 0" }}>
            Indexed folders
          </h3>
          <p style={{ fontSize: 11, color: t.dim, margin: "0 0 12px 0", lineHeight: 1.45 }}>
            Drive folders Yomi keeps searchable in your knowledge base.
          </p>

          <div
            style={{
              borderRadius: 12,
              border: `1px solid ${t.border}`,
              background: t.surface,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={driveFolderId}
                onChange={(e) => setDriveFolderId(e.target.value)}
                placeholder="Drive folder ID"
                style={{
                  flex: "1 1 160px",
                  fontSize: 11.5,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${t.border}`,
                  background: t.bg,
                  color: t.text,
                  fontFamily: UI_FONT,
                }}
              />
              <input
                value={driveName}
                onChange={(e) => setDriveName(e.target.value)}
                placeholder="Name (optional)"
                style={{
                  flex: "1 1 120px",
                  fontSize: 11.5,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${t.border}`,
                  background: t.bg,
                  color: t.text,
                  fontFamily: UI_FONT,
                }}
              />
              <button
                onClick={() => void handleAddDriveSource()}
                disabled={driveAdding}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: connectorTheme.accentText,
                  background: connectorTheme.accent,
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 14px",
                  cursor: driveAdding ? "default" : "pointer",
                  opacity: driveAdding ? 0.5 : 1,
                  fontFamily: UI_FONT,
                }}
              >
                {driveAdding ? "Adding…" : "Index this folder"}
              </button>
            </div>

            {driveError && (
              <div
                style={{
                  padding: "0 14px 10px",
                  fontSize: 10.5,
                  color: connectorTheme.error,
                }}
              >
                {driveError}
              </div>
            )}

            {driveSources.length > 0 && (
              <div style={{ borderTop: `1px solid ${t.border}` }}>
                {driveSources.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderBottom: `1px solid ${t.border}`,
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{s.name}</div>
                      <div style={{ fontSize: 10.5, color: t.dim }}>
                        {s.status} · {s.syncState?.filesIndexed ?? 0} files indexed
                      </div>
                    </div>
                    <button
                      onClick={() => void handleRemoveDriveSource(s.id)}
                      disabled={driveRemovingId === s.id}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: connectorTheme.error,
                        background: "transparent",
                        border: `1px solid ${t.border}`,
                        borderRadius: 8,
                        padding: "5px 12px",
                        cursor: driveRemovingId === s.id ? "default" : "pointer",
                        opacity: driveRemovingId === s.id ? 0.5 : 1,
                        fontFamily: UI_FONT,
                      }}
                    >
                      {driveRemovingId === s.id ? "…" : "Remove"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!driveLoading && driveSources.length === 0 && !driveError && (
              <div style={{ padding: "0 14px 12px", fontSize: 10.5, color: t.dim }}>
                No folders indexed yet.
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Suggested automations — one-tap schedules for connected tools */}
      {suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          style={{ marginTop: 24 }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 700, color: t.text, margin: "0 0 2px 0" }}>
            Suggested automations
          </h3>
          <p style={{ fontSize: 11, color: t.dim, margin: "0 0 12px 0", lineHeight: 1.45 }}>
            One-tap schedules for your connected tools, delivered on Telegram.
          </p>

          <div
            style={{
              borderRadius: 12,
              border: `1px solid ${t.border}`,
              background: t.surface,
              overflow: "hidden",
            }}
          >
            {suggestionError && (
              <div style={{ padding: "10px 14px 0", fontSize: 10.5, color: connectorTheme.error }}>
                {suggestionError}
              </div>
            )}

            {suggestions.map((s, i) => {
              const busy = suggestionBusyKey === s.dedupKey
              const enabled = suggestionEnabledKey === s.dedupKey
              return (
                <div
                  key={s.dedupKey}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderBottom:
                      i < suggestions.length - 1 ? `1px solid ${t.border}` : undefined,
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{s.title}</div>
                    <div style={{ fontSize: 10.5, color: t.dim, lineHeight: 1.4 }}>
                      {s.description} · {s.schedulePreview}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => void handleAcceptSuggestion(s.dedupKey)}
                      disabled={busy || enabled}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: enabled ? connectorTheme.successText : connectorTheme.accentText,
                        background: enabled ? connectorTheme.successBg : connectorTheme.accent,
                        border: "none",
                        borderRadius: 8,
                        padding: "5px 12px",
                        cursor: busy || enabled ? "default" : "pointer",
                        opacity: busy ? 0.5 : 1,
                        fontFamily: UI_FONT,
                      }}
                    >
                      {enabled ? "Scheduled ✓" : busy ? "…" : "Enable"}
                    </button>
                    <button
                      onClick={() => void handleDismissSuggestion(s.dedupKey)}
                      disabled={busy || enabled}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: connectorTheme.error,
                        background: "transparent",
                        border: `1px solid ${t.border}`,
                        borderRadius: 8,
                        padding: "5px 12px",
                        cursor: busy || enabled ? "default" : "pointer",
                        opacity: busy ? 0.5 : 1,
                        fontFamily: UI_FONT,
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
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
