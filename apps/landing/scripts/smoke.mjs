// Post-deploy smoke test. wrangler reports success even when the deployed site is broken:
// /sitemap.xml 307'd to / for the whole life of the site yet still passed a build and a
// deploy. Only the live URL tells you.

const BASE = (process.argv[2] ?? process.env["SMOKE_BASE_URL"] ?? "https://getyomi.in").replace(
  /\/$/,
  "",
)

const ATTEMPTS = 3
const RETRY_MS = 3000

// Each check gets the Response; return null to pass, or a string describing the failure.
const CHECKS = [
  {
    path: "/",
    check: async (res, body) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      // the hero used to ship at opacity:0, invisible to crawlers and no-js readers
      if (!body.includes("AI productivity assistant")) return "hero copy missing from html"
      return null
    },
  },
  {
    path: "/robots.txt",
    check: async (res, body) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      if (!body.includes("Sitemap:")) return "no Sitemap: line — cloudflare's managed robots.txt?"
      return null
    },
  },
  {
    path: "/sitemap.xml",
    check: async (res, body) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      if (!body.includes("<urlset")) return "not a sitemap — empty dir shipped instead of the body?"
      return null
    },
  },
  {
    path: "/privacy",
    check: async (res, body) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      // google's oauth review rejects a policy missing the limited use wording
      if (!body.includes("Limited Use")) return "Limited Use clause missing"
      return null
    },
  },
  { path: "/terms", check: async (res) => (res.status === 200 ? null : `got ${res.status}`) },
  { path: "/docs", check: async (res) => (res.status === 200 ? null : `got ${res.status}`) },
  { path: "/support", check: async (res) => (res.status === 200 ? null : `got ${res.status}`) },
  {
    path: "/llms.txt",
    check: async (res, body) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      if (!body.startsWith("# ")) return "missing required H1 header"
      if (!body.includes("](")) return "no markdown links found"
      return null
    },
  },
  {
    path: "/opengraph-image",
    check: async (res) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      // the edge-runtime OG route never got prerendered as a static asset — the worker
      // 404'd it and cloudflare redirected to "/", which google flagged as a broken page
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.startsWith("image/")) return `expected an image, got content-type ${contentType}`
      return null
    },
  },
  {
    path: "/signin",
    check: async (res, body) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`
      // a bare "Google" label fails google's oauth brand verification
      if (!body.includes("Sign in with Google")) return "google button is not branded correctly"
      return null
    },
  },
  ...[
    ["/features", "/#features"],
    ["/pricing", "/#pricing"],
    ["/contact", "/support"],
    ["/download", "/"],
  ].map(([path, target]) => ({
    path,
    redirect: "manual",
    // next.config redirects do not run in an asset-only worker deploy; these live in worker.ts
    check: async (res) => {
      if (res.status !== 301) return `expected 301, got ${res.status}`
      const location = res.headers.get("location") ?? ""
      if (!location.endsWith(target)) return `redirects to ${location}, expected ${target}`
      return null
    },
  })),
]

async function run({ path, check, redirect }) {
  let last = "no attempt made"
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        redirect: redirect ?? "follow",
        headers: { "cache-control": "no-cache" },
      })
      const body = redirect === "manual" ? "" : await res.text()
      const failure = await check(res, body)
      if (!failure) return null
      last = failure
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_MS))
  }
  return last
}

const results = await Promise.all(
  CHECKS.map(async (c) => ({ path: c.path, failure: await run(c) })),
)

for (const { path, failure } of results) {
  console.log(failure ? `FAIL  ${path}  — ${failure}` : `ok    ${path}`)
}

const failed = results.filter((r) => r.failure)
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${results.length} checks failed against ${BASE}`)
  process.exit(1)
}
console.log(`\nall ${results.length} checks passed against ${BASE}`)
