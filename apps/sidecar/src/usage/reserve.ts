function backendBaseUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function sessionToken(): string {
  return process.env["YOMI_SESSION_TOKEN"] ?? ""
}

export type ReserveKind = "chat" | "voice" | "analyze" | "bot_message"

type ReserveResult =
  | { ok: true; usageEventId?: string }
  | { ok: false; error: string; code: string; feature?: string; upgradeUrl?: string }

export type FinalizeTelemetry = {
  requestId: string
  endpoint: string
  surface: string
  route?: string
  latencyMs?: number
  firstTokenLatencyMs?: number
  toolCalls?: number
  connectorIds?: string[]
  visionImages?: number
  maxOutputTokens?: number
}

export type FinalizeUsageInput = {
  usageEventId?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  status?: "done" | "error" | "cancelled" | "budget_exhausted"
  metadata?: Record<string, unknown>
  telemetry?: FinalizeTelemetry
}

export async function reserveInteraction(kind: ReserveKind): Promise<ReserveResult> {
  const token = sessionToken()
  if (!token) return { ok: true }

  try {
    const res = await fetch(`${backendBaseUrl()}/api/usage/interactions/reserve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind }),
    })

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return {
        ok: true,
        ...(typeof data["usageEventId"] === "string" ? { usageEventId: data["usageEventId"] } : {}),
      }
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return {
      ok: false,
      error: typeof data["error"] === "string" ? data["error"] : "Usage limit reached.",
      code: typeof data["code"] === "string" ? data["code"] : "quota_exceeded",
      feature: typeof data["feature"] === "string" ? data["feature"] : undefined,
      ...(typeof data["upgradeUrl"] === "string" ? { upgradeUrl: data["upgradeUrl"] } : {}),
    }
  } catch {
    return { ok: true }
  }
}

export function finalizeInteractionUsage(input: FinalizeUsageInput): void {
  const token = sessionToken()
  if (!token || !input.usageEventId) return

  fetch(`${backendBaseUrl()}/api/usage/interactions/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  }).catch(() => {})
}

export function reportUsage(kind: string): void {
  const token = sessionToken()
  if (!token) return

  fetch(`${backendBaseUrl()}/api/usage/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ kind }),
  }).catch(() => {})
}
