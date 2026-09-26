#!/usr/bin/env tsx
// Fails when user-facing docs drift from the code that is their source of truth.
// Connector registry metadata lives in packages/ui/src/catalog.ts (the
// dashboard's display catalog); runtime connector defs are being ported to Python
// (apps/api/src/yomi/connectors). Scope is deliberately narrow to stay
// high-signal and false-positive free. Extend the SOURCES map as new duplicated
// facts appear. See AGENTS.md "Docs: sources of truth".
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..")
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const errors: string[] = []

const CATALOG = "packages/ui/src/catalog.ts"

type Connector = { id: string; name: string }

function catalogConnectors(): Connector[] {
  const src = read(CATALOG)
  const arr = src.match(/CATALOG_DEFS[^=]*=\s*\[([\s\S]*?)\n\]/)
  if (!arr) throw new Error("could not find CATALOG_DEFS array in catalog.ts")
  const out: Connector[] = []
  for (const block of arr[1].matchAll(/\{\s*([\s\S]*?)\n\s*\},/g)) {
    const body = block[1]
    if (!body) continue
    const id = body.match(/id:\s*"([^"]+)"/)?.[1]
    const name = body.match(/name:\s*"([^"]+)"/)?.[1]
    if (!id || !name) throw new Error("could not read connector id/name from catalog.ts")
    out.push({ id, name })
  }
  return out
}

const connectors = catalogConnectors()

// 1. docs/specs/connectors/00-index.md must list every catalog connector id.
{
  const doc = read("docs/specs/connectors/00-index.md")
  for (const c of connectors) {
    if (!doc.includes(`\`${c.id}\``)) {
      errors.push(`docs/specs/connectors/00-index.md is missing registered connector \`${c.id}\``)
    }
  }
}

// 2. AGENTS.md must name the connectors it claims to support (first-class set
//    plus the named Composio-backed list; the rest are covered by "etc.").
{
  const doc = read("AGENTS.md")
  const expected = [
    "Gmail", "Calendar", "Drive", "GitHub", "Slack", "Notion", "Linear",
    "Docs", "Sheets", "Slides", "Maps", "Photos", "HubSpot", "Salesforce",
    "Discord", "LinkedIn", "Outlook", "Teams", "OneDrive",
    "Dropbox", "Figma", "YouTube", "Zoom", "Stripe",
  ]
  for (const keyword of expected) {
    if (!doc.includes(keyword)) {
      errors.push(`AGENTS.md does not mention connector "${keyword}"`)
    }
  }
}

if (errors.length) {
  console.error("docs are out of sync with code:\n")
  for (const e of errors) console.error(`  - ${e}`)
  console.error("\nUpdate the docs above (see AGENTS.md → Docs: sources of truth).")
  process.exit(1)
}
console.log(`docs-sync ok: ${connectors.length} connectors verified across specs + docs`)
