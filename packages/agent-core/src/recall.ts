import { tool } from "ai"
import { z } from "zod"

export interface SessionRecallResult {
  sessionId: string
  title: string | null
  summary: string | null
  messageCount: number
  closedAt: string | null
  relevance: number
  matchedMessages?: {
    role: "user" | "assistant"
    contentPreview: string
    createdAt: string
  }[]
}

export type RecallSearchFn = (
  query: string,
  limit: number,
) => Promise<SessionRecallResult[]>

export function createRecallTool(search: RecallSearchFn) {
  return tool({
    description:
      "Search past conversations the user had with Yomi. Use this when the user asks " +
      "\"what did we discuss last week?\", \"remind me what I asked about X\", or " +
      "\"what did we decide about Y?\". Returns summarized results from closed sessions.",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .max(500)
        .describe("Natural-language search query (e.g. 'pricing page discussion')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .default(5)
        .describe("Maximum number of past sessions to return (default 5, max 15)"),
    }),
    execute: async ({ query, limit }) => {
      return search(query, limit ?? 5)
    },
  })
}
