import { describe, expect, it } from "vitest"
import { DOCS_GROUPS, DOCS_PAGES, docsHref, matchesQuery, neighbours } from "./docs-pages"

describe("docs pages", () => {
  it("has unique slugs, known groups and section ids", () => {
    const slugs = DOCS_PAGES.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const page of DOCS_PAGES) {
      expect(DOCS_GROUPS).toContain(page.group)
      const ids = page.sections.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it("puts meet yomi at /docs and the rest under it", () => {
    expect(docsHref(DOCS_PAGES[0]!)).toBe("/docs")
    expect(docsHref({ slug: "plans" })).toBe("/docs/plans")
  })

  it("searches titles, summaries and section titles, ignoring case", () => {
    const plans = DOCS_PAGES.find((p) => p.slug === "plans")!
    expect(matchesQuery(plans, "  PLANS ")).toBe(true)
    expect(matchesQuery(plans, "smarter engine")).toBe(true)
    expect(matchesQuery(plans, "get pro free")).toBe(true)
    expect(matchesQuery(plans, "xyzzy")).toBe(false)
  })

  it("links each page to its neighbours", () => {
    expect(neighbours("").prev).toBeUndefined()
    expect(neighbours("").next?.slug).toBe("getting-started")
    expect(neighbours(DOCS_PAGES.at(-1)!.slug).next).toBeUndefined()
  })
})
