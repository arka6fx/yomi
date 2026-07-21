import { tool } from "ai"
import { z } from "zod"

export interface WebSearchCitation {
  title: string
  url: string
}

export interface WebSearchResult {
  answer: string
  citations: WebSearchCitation[]
}

export type WebSearchFn = (query: string) => Promise<WebSearchResult>

interface ResponsesAnnotation {
  type: string
  url?: string
  title?: string
}

interface ResponsesContentBlock {
  type: string
  text?: string
  annotations?: ResponsesAnnotation[]
}

interface ResponsesOutputItem {
  type: string
  content?: ResponsesContentBlock[]
}

// Parses the OpenAI Responses API's `output` array for a web_search-tool call:
// https://developers.openai.com/api/docs/guides/tools-web-search
export function parseResponsesOutput(output: ResponsesOutputItem[]): WebSearchResult {
  const message = output.find((item) => item.type === "message")
  const textBlock = message?.content?.find((block) => block.type === "output_text")
  const answer = textBlock?.text?.trim() ?? ""
  const citations: WebSearchCitation[] = (textBlock?.annotations ?? [])
    .filter((a): a is ResponsesAnnotation & { url: string } => a.type === "url_citation" && !!a.url)
    .map((a) => ({ title: a.title || a.url, url: a.url }))
  return { answer, citations }
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "gpt-5.4-mini"

function baseUrl(): string {
  return (process.env["OPENAI_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

// Calls OpenAI's Responses API with the provider-executed web_search tool.
// A side-call, not part of the main agent's model — Yomi's agent loop talks
// to /chat/completions via a hand-rolled LanguageModelV1 (see model.ts) that
// can't translate provider-defined tools, which only exist on /responses.
export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
  const model = process.env["OPENAI_WEB_SEARCH_MODEL"] || DEFAULT_MODEL
  const response = await fetch(`${baseUrl()}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["OPENAI_API_KEY"] ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }],
      input: query,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `OpenAI web search failed (${response.status}): ${text || response.statusText}`,
    )
  }

  const json = (await response.json()) as { output?: ResponsesOutputItem[] }
  return parseResponsesOutput(json.output ?? [])
}

export function createWebSearchTool(search: WebSearchFn) {
  return tool({
    description:
      "Search the live web for current information beyond your knowledge cutoff " +
      "(news, prices, recent releases, current events, anything time-sensitive). " +
      "Returns a synthesized answer with source citations.",
    parameters: z.object({
      query: z.string().min(1).max(500).describe("Natural-language search query"),
    }),
    execute: async ({ query }) => search(query),
  })
}
