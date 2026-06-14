import type { ConnectorCategory } from "@yomi/agent-core"

export type { ConnectorCategory }

export interface ConnectorInfo {
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "api_key" | "connection_string"
  icon: string
  /** True if this connector is fully wired (has env vars + backend handler). False = coming soon. */
  available: boolean
  /** Set when the user has connected this connector */
  connected?: boolean
  displayName?: string
  lastSyncAt?: string | null
}

/** Minimal theme tokens used by ConnectorMarketplace. Pass your app's values. */
export interface ConnectorTheme {
  bg: string
  surface: string
  border: string
  borderHi: string
  text: string
  dim: string
  accent: string
  accentText: string
  error: string
  successBg: string
  successBorder: string
  successText: string
  btnBg: string
  btnText: string
  font: string
}

export const DARK_THEME: ConnectorTheme = {
  bg: "#111111",
  surface: "#1a1a1a",
  border: "rgba(255,255,255,0.08)",
  borderHi: "rgba(255,255,255,0.16)",
  text: "#e8e8e8",
  dim: "#888",
  accent: "#e07b39",
  accentText: "#fff",
  error: "#e5534b",
  successBg: "rgba(16,185,129,0.1)",
  successBorder: "rgba(16,185,129,0.2)",
  successText: "#10B981",
  btnBg: "rgba(255,255,255,0.06)",
  btnText: "#ccc",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

export const LIGHT_THEME: ConnectorTheme = {
  bg: "#ffffff",
  surface: "#f9f9f9",
  border: "rgba(0,0,0,0.1)",
  borderHi: "rgba(0,0,0,0.2)",
  text: "#111",
  dim: "#666",
  accent: "#e07b39",
  accentText: "#fff",
  error: "#dc2626",
  successBg: "rgba(16,185,129,0.08)",
  successBorder: "rgba(16,185,129,0.2)",
  successText: "#059669",
  btnBg: "rgba(0,0,0,0.04)",
  btnText: "#444",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}
