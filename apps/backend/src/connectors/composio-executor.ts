import type { ComposioExecutor } from "@yomi/agent-core"

// Raw-fetch Composio tool executor. Matches the native connectors' fetch style
// (no new npm dependency) and is the single place a Composio tool call leaves the
// backend. Reads COMPOSIO_API_KEY; the base URL is overridable for tests.
//
// REST: POST {base}/api/v3/tools/execute/{slug}
//   headers: x-api-key
//   body:    { user_id, arguments }
// Composio resolves the user's connected account for the toolkit from user_id.

const DEFAULT_BASE_URL = "https://backend.composio.dev"

export interface ComposioRestConfig {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export function composioBaseUrl(): string {
  return process.env["COMPOSIO_BASE_URL"] || DEFAULT_BASE_URL
}

export function createComposioRestExecutor(config?: Partial<ComposioRestConfig>): ComposioExecutor {
  const apiKey = config?.apiKey ?? process.env["COMPOSIO_API_KEY"] ?? ""
  const baseUrl = config?.baseUrl ?? composioBaseUrl()
  const doFetch = config?.fetchImpl ?? fetch

  return {
    async execute({ userId, slug, arguments: args }) {
      if (!apiKey) throw new Error("COMPOSIO_API_KEY not set")
      const res = await doFetch(`${baseUrl}/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ user_id: userId, arguments: args ?? {} }),
      })
      const text = await res.text()
      let body: unknown
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = { raw: text }
      }
      if (!res.ok) {
        const detail =
          typeof body === "object" && body && "error" in body
            ? String((body as { error: unknown }).error)
            : text.slice(0, 300)
        throw new Error(`Composio execute ${slug} → status ${res.status}: ${detail}`)
      }
      // Composio wraps results as { data, error, successful }. Surface the useful
      // parts to the agent; a failed-but-200 response carries `error`.
      if (body && typeof body === "object") {
        const b = body as { data?: unknown; error?: unknown; successful?: boolean }
        if (b.successful === false || b.error) {
          return { error: b.error ? String(b.error) : "Composio tool call failed" }
        }
        if ("data" in b) return b.data
      }
      return body
    },
  }
}
