import { tool, jsonSchema } from "ai"

export function createWebTools() {
  return {
    web_search: tool({
      description: "Search the web for information. Returns titles, URLs, and snippets.",
      parameters: jsonSchema<{ query: string; max_results: number }>({
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number", default: 5, minimum: 1, maximum: 10 },
        },
        required: ["query"],
      }),
      execute: async ({ query, max_results = 5 }) => {
        const apiKey = process.env.BRAVE_SEARCH_API_KEY
        if (!apiKey) return { error: "BRAVE_SEARCH_API_KEY not configured" }

        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max_results}`
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok) return { error: `Search API returned ${res.status}` }

        const data = (await res.json()) as any
        return (data.web?.results ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }))
      },
    }),

    fetch_url: tool({
      description: "Fetch the text content of a URL, returned as plain text (HTML tags stripped)",
      parameters: jsonSchema<{ url: string }>({
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
        },
        required: ["url"],
      }),
      execute: async ({ url }) => {
        const res = await fetch(url, {
          headers: { "User-Agent": "Yomi/0.1 (desktop AI assistant)" },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return { error: `HTTP ${res.status} from ${url}` }

        const html = await res.text()
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
        return text.slice(0, 20_000)
      },
    }),
  }
}
