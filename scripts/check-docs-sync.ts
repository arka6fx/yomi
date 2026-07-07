#!/usr/bin/env bun
// Fails when user-facing docs drift from the code that is their source of truth.
// Scope is deliberately narrow (connectors + Google OAuth scopes) to stay
// high-signal and false-positive free. Extend the SOURCES map as new
// duplicated facts appear. See AGENTS.md "Docs: sources of truth".
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const errors: string[] = []

const CONNECTORS_DIR = "packages/agent-core/src/connectors"

type Connector = { id: string; name: string; file: string; scopes: string[] }

function registeredConnectors(): Connector[] {
  const allDefs = read(`${CONNECTORS_DIR}/all-defs.ts`)

  // import { fooDef } from "./foo-def.js"  ->  fooDef -> foo-def.ts
  const varToFile = new Map<string, string>()
  for (const m of allDefs.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/([^"]+)\.js"/g)) {
    const file = `${m[2]}.ts`
    for (const raw of m[1].split(",")) {
      const v = raw.trim()
      if (v) varToFile.set(v, file)
    }
  }

  // The variables actually listed in the ALL_CONNECTOR_DEFS array.
  const arr = allDefs.match(/ALL_CONNECTOR_DEFS[^=]*=\s*\[([\s\S]*?)\]/)
  if (!arr) throw new Error("could not find ALL_CONNECTOR_DEFS array in all-defs.ts")
  const vars = [...arr[1].matchAll(/([a-zA-Z0-9_]+Def)\b/g)].map((m) => m[1])

  const seen = new Set<string>()
  const out: Connector[] = []
  for (const v of vars) {
    if (seen.has(v)) continue
    seen.add(v)
    const file = varToFile.get(v)
    if (!file) throw new Error(`no import found for connector def ${v}`)
    const src = read(`${CONNECTORS_DIR}/${file}`)
    // The connector def declares id and name on consecutive lines; other `id:`
    // occurrences (e.g. a default "primary" account) are not the connector id.
    const def = src.match(/\bid:\s*"([^"]+)",[^\n]*\n\s*name:\s*"([^"]+)"/)
    const id = def?.[1]
    const name = def?.[2]
    if (!id || !name) throw new Error(`could not read connector id/name from ${file}`)
    const scopeBlock = src.match(/scopes:\s*\[([\s\S]*?)\]/)?.[1] ?? ""
    const scopes = [...scopeBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    out.push({ id, name, file, scopes })
  }
  return out
}

const connectors = registeredConnectors()
const registeredIds = new Set(connectors.map((c) => c.id))
// linear-api-key shares the "linear" surface in user-facing docs.
const docId = (id: string) => (id === "linear-api-key" ? "linear" : id)
const expectedDocIds = new Set(connectors.map((c) => docId(c.id)))

// 1. specs/connectors/00-index.md must list every registered runtime id.
{
  const doc = read("specs/connectors/00-index.md")
  for (const c of connectors) {
    if (!doc.includes(`\`${c.id}\``)) {
      errors.push(`specs/connectors/00-index.md is missing registered connector \`${c.id}\``)
    }
  }
}

// 2. docs page CONNECTORS array must match the registered set (both directions).
{
  const doc = read("apps/landing/src/app/docs/page.tsx")
  const block = doc.match(/const CONNECTORS[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? ""
  const docIds = new Set([...block.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]))
  for (const id of expectedDocIds) {
    if (!docIds.has(id)) errors.push(`docs page CONNECTORS is missing connector "${id}"`)
  }
  for (const id of docIds) {
    if (!expectedDocIds.has(id)) {
      errors.push(`docs page CONNECTORS lists "${id}", which is not a registered connector`)
    }
  }
}

// 3. AGENTS.md must name every registered connector (skip the api-key twin).
{
  const doc = read("AGENTS.md")
  for (const c of connectors) {
    if (c.id === "linear-api-key") continue
    const keyword = c.name.split(" ").at(-1)! // "Google Drive" -> "Drive"
    if (!doc.includes(keyword)) {
      errors.push(`AGENTS.md does not mention connector "${c.name}" (looked for "${keyword}")`)
    }
  }
}

// 4. Privacy page must not claim a narrower Google scope than the code requests.
{
  const privacy = read("apps/landing/src/app/privacy/page.tsx")
  const narrowByBroadScope: Record<string, { require?: string; forbid: string[] }> = {
    "https://mail.google.com/": {
      require: "mail.google.com",
      forbid: ["gmail.readonly", "gmail.modify", "gmail.send", "gmail.compose"],
    },
    "https://www.googleapis.com/auth/calendar": {
      forbid: ["calendar.readonly", "calendar.events.readonly"],
    },
    "https://www.googleapis.com/auth/drive": {
      forbid: ["drive.file", "drive.readonly", "drive.metadata"],
    },
  }
  for (const c of connectors) {
    for (const [broad, rule] of Object.entries(narrowByBroadScope)) {
      if (!c.scopes.includes(broad)) continue
      if (rule.require && !privacy.includes(rule.require)) {
        errors.push(
          `privacy page must state the "${rule.require}" scope that ${c.name} actually requests`,
        )
      }
      for (const narrow of rule.forbid) {
        if (privacy.includes(narrow)) {
          errors.push(
            `privacy page claims "${narrow}" but ${c.name} requests the broader "${broad}"`,
          )
        }
      }
    }
  }
}

if (errors.length) {
  console.error("docs are out of sync with code:\n")
  for (const e of errors) console.error(`  - ${e}`)
  console.error("\nUpdate the docs above (see AGENTS.md → Docs: sources of truth).")
  process.exit(1)
}
console.log(`docs-sync ok: ${connectors.length} connectors verified across specs, docs, privacy`)
