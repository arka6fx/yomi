import type { ComposioCatalogTool, ComposioToolSpec } from "@yomi/agent-core"
import { composioCatalogToolToSpec } from "@yomi/agent-core"

interface CatalogResponse {
  items?: ComposioCatalogTool[]
}

const DEFAULT_BASE_URL = "https://backend.composio.dev"
const TOOLKIT_TIMEOUT_MS = 5_000
const CATALOG_CONCURRENCY = 8
let catalogPromise: Promise<ComposioToolSpec[]> | null = null

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

// Best-effort and cached per process. A catalog outage must never remove the
// stable hand-written connector tools; callers fall back to those definitions.
export function loadComposioCatalog(): Promise<ComposioToolSpec[]> {
  if (catalogPromise) return catalogPromise
  if (process.env.NODE_ENV === "test") {
    catalogPromise = Promise.resolve([])
    return catalogPromise
  }
  const apiKey = process.env["COMPOSIO_API_KEY"]
  const toolkits = toolkitList()
  catalogPromise =
    !apiKey || !toolkits.length
      ? Promise.resolve([])
      : (async () => {
          const specs: ComposioToolSpec[] = []
          for (let i = 0; i < toolkits.length; i += CATALOG_CONCURRENCY) {
            const batch = toolkits.slice(i, i + CATALOG_CONCURRENCY)
            const results = await Promise.allSettled(
              batch.map((toolkit) => loadToolkit(toolkit, apiKey)),
            )
            for (const result of results) {
              if (result.status === "fulfilled") specs.push(...result.value)
            }
          }
          return specs
        })()
  return catalogPromise
}
