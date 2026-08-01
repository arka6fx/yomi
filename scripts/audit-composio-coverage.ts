// Diffs every wired Composio connector against the toolkit's live action list.
// Answers "what is Composio offering that we haven't wired?" for all connectors
// at once, instead of reading docs pages one at a time.
//
//   bun scripts/audit-composio-coverage.ts                  # all connectors
//   bun scripts/audit-composio-coverage.ts google-photos    # one connector
//   bun scripts/audit-composio-coverage.ts --json           # machine-readable
//
// Needs COMPOSIO_API_KEY. It is not in the repo root .env — the backend's own
// env has it, so this loads apps/backend/.env when the var is not already set.
import { readFileSync } from "node:fs"
import { ALL_CONNECTOR_DEFS } from "../packages/agent-core/src/connectors/all-defs.js"
import { COMPOSIO_RISK_MAP } from "../packages/agent-core/src/connectors/composio/classification.js"

const BASE_URL = process.env["COMPOSIO_BASE_URL"] ?? "https://backend.composio.dev"

function apiKey(): string {
  if (process.env["COMPOSIO_API_KEY"]) return process.env["COMPOSIO_API_KEY"]
  try {
    const raw = readFileSync(new URL("../apps/backend/.env", import.meta.url), "utf8")
    const line = raw.split("\n").find((l) => l.startsWith("COMPOSIO_API_KEY="))
    if (line) return line.slice("COMPOSIO_API_KEY=".length).trim()
  } catch {
    // fall through to the error below
  }
  throw new Error("COMPOSIO_API_KEY not set and not found in apps/backend/.env")
}

// Pages through every tool for a toolkit. Composio caps page size, so a single
// unpaginated call silently truncates — the exact trap that made an earlier audit
// report connectors as complete when they were not.
async function liveSlugs(toolkit: string, key: string): Promise<string[]> {
  const slugs = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 50; page++) {
    const url = new URL("/api/v3/tools", BASE_URL)
    url.searchParams.set("toolkit_slug", toolkit)
    url.searchParams.set("limit", "100")
    if (cursor) url.searchParams.set("cursor", cursor)

    const res = await fetch(url, { headers: { "x-api-key": key } })
    if (!res.ok) throw new Error(`${toolkit}: ${res.status} ${(await res.text()).slice(0, 200)}`)

    const body = (await res.json()) as { items?: { slug: string }[]; next_cursor?: string | null }
    for (const item of body.items ?? []) slugs.add(item.slug)
    cursor = body.next_cursor ?? null
    if (!cursor) break
  }
  return [...slugs].sort()
}

const ctx = {
  userId: "audit",
  getAccessToken: async () => "audit",
  createPendingAction: async () => "audit",
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const only = args.filter((a) => !a.startsWith("--"))
  const key = apiKey()

  const defs = ALL_CONNECTOR_DEFS.filter(
    (d) => d.auth.kind === "composio" && !d.isMCPBased && (!only.length || only.includes(d.id)),
  )
  if (!defs.length) throw new Error(`no composio connector matched: ${only.join(", ")}`)

  const results = []
  for (const def of defs) {
    const toolkit = def.auth.kind === "composio" ? def.auth.toolkit : ""
    const wired = Object.keys(def.tools(ctx as never)).sort()
    const block = COMPOSIO_RISK_MAP[toolkit.toLowerCase()] ?? {}

    let live: string[]
    try {
      live = await liveSlugs(toolkit, key)
    } catch (err) {
      results.push({ id: def.id, toolkit, error: String(err) })
      continue
    }

    results.push({
      id: def.id,
      toolkit,
      live: live.length,
      wired: wired.length,
      // Offered by Composio, not wired here.
      missing: live.filter((s) => !wired.includes(s)),
      // Wired here but absent from the live catalog — a renamed or removed slug,
      // which fails at call time rather than surfacing as a build error.
      stale: wired.filter((s) => !live.includes(s)),
      unclassified: wired.filter((s) => !(s in block)),
    })
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  let totalMissing = 0
  let totalStale = 0
  let totalUnclassified = 0
  for (const r of results.sort((a, b) => (b.missing?.length ?? 0) - (a.missing?.length ?? 0))) {
    if (r.error) {
      console.log(`\n${r.id} (${r.toolkit})\n  ERROR ${r.error}`)
      continue
    }
    totalMissing += r.missing!.length
    totalStale += r.stale!.length
    totalUnclassified += r.unclassified!.length
    const flag = r.missing!.length || r.stale!.length || r.unclassified!.length ? "" : "  ✓"
    console.log(`\n${r.id} (${r.toolkit}) — wired ${r.wired}/${r.live}${flag}`)
    if (r.missing!.length) console.log(`  missing (${r.missing!.length}): ${r.missing!.join(", ")}`)
    if (r.stale!.length) console.log(`  STALE (${r.stale!.length}): ${r.stale!.join(", ")}`)
    if (r.unclassified!.length)
      console.log(`  unclassified (${r.unclassified!.length}): ${r.unclassified!.join(", ")}`)
  }

  console.log(
    `\n─── ${results.length} connectors | ${totalMissing} missing | ${totalStale} stale | ${totalUnclassified} unclassified`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
