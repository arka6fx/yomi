// Post-deploy smoke test. wrangler reports success even when the deployed site is broken:
// /sitemap.xml 307'd to / for the whole life of the site yet still passed a build and a
// deploy. Only the live URL tells you.

const BASE = (process.argv[2] ?? process.env["SMOKE_BASE_URL"] ?? "https://getyomi.in").replace(
  /\/$/,
  "",
)

// A path that did not exist before this deploy can still be answered from the edge with the
// old response for a few seconds after wrangler returns. That is how adding llms.txt failed
// its own deploy: the edge replied with the pre-deploy 307 to /, the check followed it to the
// homepage and reported the file as having no H1, while the file itself was already correct.
// Cache-busting via a query param does not help — Cloudflare normalises the query string out
// of the cache key for static assets — so the only lever here is waiting longer.
const ATTEMPTS = 6
const RETRY_MS = 5000

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
  // /pricing, /skills and /faq are real pages now; /pricing used to redirect to /#pricing
  ...["/pricing", "/skills", "/skills/morning-brief", "/faq"].map((path) => ({
    path,
    check: async (res) => (res.status === 200 ? null : `got ${res.status}`),
  })),
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
      if (!contentType.startsWith("image/"))
        return `expected an image, got content-type ${contentType}`
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
  {
    // The asset binding answers an unknown path with a 307 to "/", and the worker used to
    // pass that through — every dead link soft-redirected to the homepage, which Search
    // Console reported as "Page with redirect". Must be a real 404, not a redirect and not
    // a 200 soft-404.
    path: "/this-path-should-never-exist-smoke",
    redirect: "manual",
    check: async (res) => {
      if (res.status === 307 || res.status === 301 || res.status === 302)
        return `soft-redirects to ${res.headers.get("location")} instead of 404ing`
      if (res.status !== 404) return `expected 404, got ${res.status}`
      return null
    },
  },
  {
    // The guard against over-correcting the above: dropping a redundant trailing slash is
    // a legitimate normalization of a page that really exists, and must keep redirecting.
    path: "/docs/",
    redirect: "manual",
    check: async (res) => {
      if (res.status !== 307) return `expected 307, got ${res.status}`
      const location = res.headers.get("location") ?? ""
      if (!location.endsWith("/docs")) return `redirects to ${location}, expected /docs`
      return null
    },
  },
  ...["/docs//", "/docs%2F"].map((path) => ({
    // The over-correction had a second half: the worker only modelled two of the binding's
    // normalizations, so a URL that names a real page via a duplicate slash or an escaped
    // one was answered with a 404 instead of its canonical redirect. A leading "//docs" is
    // the same bug but fetch normalizes it before it leaves the client — unit test only.
    path,
    redirect: "manual",
    check: async (res) => {
      if (res.status !== 307) return `expected 307, got ${res.status}`
      const location = res.headers.get("location") ?? ""
      if (!location.endsWith("/docs")) return `redirects to ${location}, expected /docs`
      return null
    },
  })),
  {
    // Every check here fetches cold, which is how a 3xx-range bug shipped unnoticed: 304
    // Not Modified was being read as a redirect-to-nowhere and answered with a 404, so
    // only repeat visitors with a warm cache saw broken fonts and icons. Revalidate an
    // asset the way a returning browser does and require 304 or 200 — never 404.
    path: "/site.webmanifest",
    conditional: true,
    check: async (res) => {
      if (res.status === 304 || res.status === 200) return null
      return `conditional request got ${res.status} — 304 handled as a redirect?`
    },
  },
  ...[
    ["/features", "/#features"],
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

async function run({ path, check, redirect, conditional }) {
  let last = "no attempt made"
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const headers = { "cache-control": "no-cache" }
      if (conditional) {
        // read the live etag first, then replay it the way a warm browser cache would
        const probe = await fetch(`${BASE}${path}`, { headers })
        const etag = probe.headers.get("etag")
        if (!etag) return `no etag on ${path}, cannot test revalidation`
        headers["if-none-match"] = etag
      }
      const res = await fetch(`${BASE}${path}`, {
        redirect: redirect ?? "follow",
        headers,
      })
      const body = redirect === "manual" || conditional ? "" : await res.text()
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
