import { tool } from "ai"
import { z } from "zod"

export type IndexTextResult = { ok: true; documentId: string } | { error: string }
export type IndexTextFn = (title: string, content: string) => Promise<IndexTextResult>

export function createIndexTextTool(indexText: IndexTextFn) {
  return tool({
    description:
      "Index a piece of text into the user's searchable cloud archive so it can be " +
      "found later by the deep_research tool. Use this when the user pastes text and " +
      "asks you to remember, save, or index it.",
    parameters: z.object({
      title: z.string().min(1).max(200).describe("A short, descriptive title for this content"),
      content: z.string().min(1).max(100_000).describe("The text to index"),
    }),
    execute: async ({ title, content }) => indexText(title, content),
  })
}
