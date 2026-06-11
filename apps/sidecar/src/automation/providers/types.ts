// Provider abstraction (the spec's four execution backends). A Provider is an execution surface the
// graph delegates to; it owns its own health/repair so the validation framework can probe it.
export type ProviderId = "native" | "api" | "workflow"
// "browser" — will provide later

export interface ProviderHealth {
  ok: boolean
  detail: string
}

export interface Provider {
  id: ProviderId
  label: string
  healthCheck(): Promise<ProviderHealth>
  diagnostics(): Promise<Record<string, unknown>>
  repair(): Promise<ProviderHealth>
}

// Minimal slice of the UIA client that the native provider and native-backed agents depend on.
// Declaring the port (vs importing the singleton) keeps them injectable in unit tests.
export interface UiaPort {
  getWindowInfo(params?: { hwnd?: number }): Promise<{ window: string }>
  findWindow(params: { process?: string; titleContains?: string }): Promise<number | null>
}
