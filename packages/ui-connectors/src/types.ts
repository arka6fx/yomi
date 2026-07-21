export type ConnectorCategory =
  | "productivity"
  | "file-storage"
  | "file-management"
  | "email"
  | "data-analytics"
  | "crm"
  | "communication"
  | "developer"
  | "data"
  | "meetings"
  | "food"
  | "finance"
  | "customer-support"
  | "other"

export interface ConnectorInfo {
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "composio" | "api_key" | "connection_string"
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
  backdropFilter?: string
  cardShadow?: string
}

export const DARK_THEME: ConnectorTheme = {
  bg: "rgba(5, 8, 18, 0.4)",
  surface: "rgba(14, 17, 30, 0.6)",
  border: "rgba(255,255,255,0.09)",
  borderHi: "rgba(255,255,255,0.16)",
  text: "#e8e8e8",
  dim: "#888",
  accent: "#2563eb",
  accentText: "#fff",
  error: "#e5534b",
  successBg: "rgba(16,185,129,0.1)",
  successBorder: "rgba(16,185,129,0.2)",
  successText: "#10B981",
  btnBg: "rgba(255,255,255,0.07)",
  btnText: "#ccc",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  backdropFilter: "blur(20px) saturate(160%)",
  cardShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
}

export const LIGHT_THEME: ConnectorTheme = {
  bg: "#ffffff",
  surface: "#f8f8f7",
  border: "rgba(0,0,0,0.12)",
  borderHi: "rgba(0,0,0,0.22)",
  text: "#111",
  dim: "#666",
  accent: "#2563eb",
  accentText: "#fff",
  error: "#dc2626",
  successBg: "rgba(16,185,129,0.08)",
  successBorder: "rgba(16,185,129,0.2)",
  successText: "#059669",
  btnBg: "rgba(0,0,0,0.04)",
  btnText: "#444",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}
