import { tool } from "ai"
import { z } from "zod"

export type IndexUrlResult = { ok: true; documentId: string; title: string } | { error: string }
export type IndexUrlFn = (url: string) => Promise<IndexUrlResult>

export function createIndexUrlTool(indexUrl: IndexUrlFn) {
  return tool({
    description:
      "Fetch a URL and index its readable content into the user's searchable cloud " +
      "archive so it can be found later by the deep_research tool. Use this when the " +
      "user shares a link and asks you to remember, save, or index it.",
    parameters: z.object({
      url: z.string().url().max(2000).describe("The URL to fetch and index"),
    }),
    execute: async ({ url }) => indexUrl(url),
  })
}
