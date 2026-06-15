function backendBaseUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function sessionToken(): string {
  return process.env["YOMI_SESSION_TOKEN"] ?? ""
}

export type ReserveKind = "chat" | "voice" | "screenshot" | "reasoning" | "bot_message"

type ReserveResult =
  | { ok: true }
  | { ok: false; error: string; code: string; upgradeUrl?: string }

export async function reserveInteraction(kind: ReserveKind): Promise<ReserveResult> {
  const token = sessionToken()
  if (!token) return { ok: true } // dev mode: no auth, allow through

  try {
    const res = await fetch(`${backendBaseUrl()}/api/usage/interactions/reserve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind }),
    })

    if (res.ok) return { ok: true }

    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return {
      ok: false,
      error: typeof data["error"] === "string" ? data["error"] : "Usage limit reached.",
      code: typeof data["code"] === "string" ? data["code"] : "quota_exceeded",
      ...(typeof data["upgradeUrl"] === "string" ? { upgradeUrl: data["upgradeUrl"] } : {}),
    }
  } catch {
    // network error: allow through to avoid blocking the user
    return { ok: true }
  }
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
