import { tool } from "ai"
import { z } from "zod"
import { runAgentLoop, type RunAgentLoopOptions, type UsageInfo } from "./agent.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

// Fixed, non-configurable — more room than delegate's generic budget to cover
// 3 search tools x possible refinement + a synthesis pass. See design:
// docs/superpowers/specs/2026-08-02-deep-research-tool-design.md
const RESEARCH_MAX_STEPS = 12
const RESEARCH_MAX_OUTPUT_TOKENS = 6144
const MAX_RESEARCH_CALLS_PER_TURN = 2

const RESEARCH_SYSTEM_PREFIX =
  "You are researching a question using the rag_search, memory_search, and " +
  "web_search tools available to you. Cite every claim inline: RAG hits as " +
  "[source: <sourceName>], memory hits as [memory: <topic>], and rely on " +
  "web_search's own attached citations for web results. Search as many times " +
  "as needed to cover the question, then synthesize a single cited answer.\n\n"

export type RagSearchResult = { sourceName: string; title: string; content: string }
export type RagSearchFn = (query: string, limit: number) => Promise<RagSearchResult[]>

export type MemorySearchResult = {
  kind: string
  topic: string
  content: string
  sourcePath: string | null
  isStatic: boolean
  updatedAt: string | Date
  score: number
  matchedBy: string[]
}
export type MemorySearchFn = (query: string, limit: number) => Promise<MemorySearchResult[]>

export type WebSearchResultLike = { answer: string; citations: { title: string; url: string }[] }

export type DeepResearchRunLoopFn = (opts: RunAgentLoopOptions) => Promise<string>

const DEFAULT_RAG_LIMIT = 5
const DEFAULT_MEMORY_LIMIT = 8

function createRagSearchTool(search: RagSearchFn) {
  return tool({
    description: "Search the user's indexed RAG documents for relevant passages.",
    parameters: z.object({
      query: z.string().min(1).max(500).describe("Search query"),
      limit: z.number().int().min(1).max(10).optional().describe("Max results (default 5)"),
    }),
    execute: async ({ query, limit }) => search(query, limit ?? DEFAULT_RAG_LIMIT),
  })
}

function createMemorySearchTool(search: MemorySearchFn) {
  return tool({
    description: "Search the user's stored memory for relevant facts, preferences, and context.",
    parameters: z.object({
      query: z.string().min(1).max(500).describe("Search query"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)"),
    }),
    execute: async ({ query, limit }) => search(query, limit ?? DEFAULT_MEMORY_LIMIT),
  })
}

function createResearchWebSearchTool(search: (query: string) => Promise<WebSearchResultLike>) {
  return tool({
    description: "Search the live web for current information relevant to the research question.",
    parameters: z.object({
      query: z.string().min(1).max(500).describe("Natural-language search query"),
    }),
    execute: async ({ query }) => {
      try {
        return await search(query)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

export interface CreateDeepResearchToolOptions {
  registry: ConnectorRegistry
  ragSearch: RagSearchFn
  memorySearch: MemorySearchFn
  webSearch: (query: string) => Promise<WebSearchResultLike>
  model?: string
  system?: string
  signal?: AbortSignal
  onUsage?: (usage: UsageInfo) => void
  // Test-only override — production callers omit this and get the real runAgentLoop.
  // Same reason as delegate.ts: packages/agent-core's test script has no --isolate,
  // so mock.module-faking a sibling file would leak across test files in the package.
  runLoop?: DeepResearchRunLoopFn
}

// Depth is capped at 1 by construction: the sub-loop's extraTools below never
// includes delegate or deep_research, so a research sub-agent can never itself
// delegate or recurse into another research call.
export function createDeepResearchTool(opts: CreateDeepResearchToolOptions) {
  const runLoop = opts.runLoop ?? runAgentLoop
  let calls = 0
  return tool({
    description:
      "Research a question thoroughly using indexed documents (RAG), stored " +
      "memory, and the live web. Use this for questions that need synthesis " +
      "across multiple sources, not a single quick lookup. Returns a synthesized " +
      "answer with inline cited sources.",
    parameters: z.object({
      question: z.string().min(1).max(2000).describe("The research question"),
    }),
    execute: async ({ question }) => {
      if (calls >= MAX_RESEARCH_CALLS_PER_TURN) {
        return { error: `research limit (${MAX_RESEARCH_CALLS_PER_TURN} per turn) reached` }
      }
      calls++
      try {
        const result = await runLoop({
          registry: opts.registry,
          text: question,
          model: opts.model,
          system: RESEARCH_SYSTEM_PREFIX + (opts.system ?? ""),
          extraTools: {
            rag_search: createRagSearchTool(opts.ragSearch),
            memory_search: createMemorySearchTool(opts.memorySearch),
            web_search: createResearchWebSearchTool(opts.webSearch),
          },
          maxSteps: RESEARCH_MAX_STEPS,
          maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
          signal: opts.signal,
          onUsage: opts.onUsage,
        })
        return { result }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}
