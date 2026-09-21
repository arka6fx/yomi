import { describe, expect, test } from "vitest"

import worker, { isUrlNormalizingRedirect } from "./worker"

const at = (pathname: string) => new URL(`https://getyomi.in${pathname}`)

// ASSETS.fetch is never reached by the referral redirect (it returns before that
// call), so a stub that throws if invoked doubles as an assertion it wasn't hit.
const unusedAssets = {
  fetch: () => {
    throw new Error("ASSETS.fetch should not be called for a referral redirect")
  },
}

// Every case below was recorded from the real asset binding (wrangler dev against
// .worker-assets), not guessed: "asset 307 -> X" is what the binding actually answered.
describe("isUrlNormalizingRedirect", () => {
  test.each([
    ["/docs/", "/docs"],
    ["/docs.html", "/docs"],
    ["/docs/index.html", "/docs"],
    ["/index.html", "/"],
    // the binding collapses duplicate slashes and percent-decodes before matching, so
    // these all name a page that really exists and must keep their canonical redirect
    ["//docs", "/docs"],
    ["/docs//", "/docs"],
    ["/d%6Fcs", "/docs"],
    ["/docs%2F", "/docs"],
  ])("passes through the canonical redirect for %s", (requested, location) => {
    expect(isUrlNormalizingRedirect(at(requested), location)).toBe(true)
  })

  test.each([
    // the miss case: unknown paths are answered with a redirect to "/" regardless of
    // what was asked for, which must stay a 404 rather than a soft redirect home
    ["/this-path-never-exists", "/"],
    ["/blog/some-dead-link", "/"],
    ["/docs/nested/deep", "/"],
    // never honour a redirect off-origin
    ["/docs/", "https://evil.example/docs"],
  ])("rejects %s -> %s", (requested, location) => {
    expect(isUrlNormalizingRedirect(at(requested), location)).toBe(false)
  })

  test("rejects a redirect with no location header", () => {
    expect(isUrlNormalizingRedirect(at("/docs/"), null)).toBe(false)
  })

  test("does not throw on a malformed percent-encoded path", () => {
    expect(isUrlNormalizingRedirect(at("/%E0%A4%A"), "/")).toBe(false)
  })
})

describe("referral redirects", () => {
  test("redirects /r/<code> to /signup?ref=<code> with a 302 and noindex", async () => {
    const request = new Request(at("/r/abc12345").toString())
    const response = await worker.fetch(request, { ASSETS: unusedAssets })

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://getyomi.in/signup?ref=abc12345")
    expect(response.headers.get("x-robots-tag")).toBe("noindex")
  })
})
