import type { ComposioCatalogTool, ComposioToolSpec } from "@yomi/agent-core"
import { composioCatalogToolToSpec } from "@yomi/agent-core"

interface CatalogResponse {
  items?: ComposioCatalogTool[]
}

const DEFAULT_BASE_URL = "https://backend.composio.dev"
const TOOLKIT_TIMEOUT_MS = 5_000
const CATALOG_CONCURRENCY = 8

// Per-toolkit cache, not one whole-catalog promise. A Worker invocation allows 50
// subrequests, and loading every configured toolkit (57 of them) on a cold isolate
// exceeded that before the agent made a single Gmail call — the loop then died and
// the reply send itself failed with "Too many subrequests by single Worker
// invocation". Only toolkits the user is actually connected to are ever needed, so
// callers pass that subset and each toolkit is fetched at most once per isolate.
const toolkitCache = new Map<string, Promise<ComposioToolSpec[]>>()

function toolkitList(): string[] {
  return [
    ...new Set(
      (process.env["COMPOSIO_CONNECTORS"] ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ]
}

function canonicalToolkitSlug(value: string): string {
  const aliases: Record<string, string> = {
    google: "gmail",
    "google-calendar": "googlecalendar",
    "google-drive": "googledrive",
    "google-docs": "googledocs",
    "google-sheets": "googlesheets",
    "google-slides": "googleslides",
    "google-classroom": "google_classroom",
    "google-tasks": "googletasks",
    "google-meet": "googlemeet",
    "google-maps": "google_maps",
    "google-photos": "googlephotos",
    "google-ads": "googleads",
    "google-analytics": "google_analytics",
    "google-search-console": "google_search_console",
    "google-cloud-vision": "google_cloud_vision",
    "microsoft-teams": "microsoft_teams",
    "one-drive": "onedrive",
    "zoho-invoice": "zoho_invoice",
    "dynamics-365": "dynamics365",
  }
  return aliases[value] ?? value.replace(/-/g, "_")
}

async function loadToolkit(toolkit: string, apiKey: string): Promise<ComposioToolSpec[]> {
  const params = new URLSearchParams({
    toolkit_slug: canonicalToolkitSlug(toolkit),
    toolkit_versions: "latest",
    include_deprecated: "false",
    limit: "1000",
  })
  const response = await fetch(
    `${process.env["COMPOSIO_BASE_URL"] ?? DEFAULT_BASE_URL}/api/v3.1/tools?${params}`,
    {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(TOOLKIT_TIMEOUT_MS),
    },
  )
  if (!response.ok) throw new Error(`catalog ${toolkit}: ${response.status}`)
  const body = (await response.json()) as CatalogResponse
  return (body.items ?? []).filter((tool) => tool.slug).map(composioCatalogToolToSpec)
}

// The Composio toolkits worth loading for a user: only the configured connectors
// they actually have connected. Mapping connector ids to canonical toolkit slugs
// happens in loadToolkit; this just narrows the fetch set so a Gmail-only user
// triggers one catalog request, not 57.
export function toolkitsForProviders(providers: string[]): string[] {
  const configured = new Set(toolkitList())
  return [...new Set(providers.map((p) => p.trim()).filter((p) => configured.has(p)))]
}

function loadToolkitCached(toolkit: string, apiKey: string): Promise<ComposioToolSpec[]> {
  const key = canonicalToolkitSlug(toolkit)
  const hit = toolkitCache.get(key)
  if (hit) return hit
  const pending = loadToolkit(toolkit, apiKey).catch((err) => {
    // Best-effort: a toolkit outage must not remove the stable hand-written tools,
    // and caching the empty result stops repeated failing fetches in this isolate.
    console.warn(
      `[composio-catalog] ${toolkit} load failed:`,
      err instanceof Error ? err.message : err,
    )
    return [] as ComposioToolSpec[]
  })
  toolkitCache.set(key, pending)
  return pending
}

// Best-effort and cached per process. A catalog outage must never remove the
// stable hand-written connector tools; callers fall back to those definitions.
// `toolkits` is the connected subset (connector ids); omit it to load every
// configured kit (used by approval replay, which passes its own connector).
export function loadComposioCatalog(toolkits?: string[]): Promise<ComposioToolSpec[]> {
  if (process.env.NODE_ENV === "test") return Promise.resolve([])
  const apiKey = process.env["COMPOSIO_API_KEY"]
  if (!apiKey) return Promise.resolve([])

  const configured = toolkitList()
  const requested = toolkits && toolkits.length > 0 ? toolkits : configured
  const wanted = [...new Set(requested.filter((t) => configured.includes(t)))]
  if (!wanted.length) return Promise.resolve([])

  return (async () => {
    const specs: ComposioToolSpec[] = []
    for (let i = 0; i < wanted.length; i += CATALOG_CONCURRENCY) {
      const batch = wanted.slice(i, i + CATALOG_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map((toolkit) => loadToolkitCached(toolkit, apiKey)),
      )
      for (const result of results) {
        if (result.status === "fulfilled") specs.push(...result.value)
      }
    }
    return specs
  })()
}
