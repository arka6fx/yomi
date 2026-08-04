import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult = { ok: true; documentId: string } | { error: string }
export type IndexDocumentFn = (title?: string) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index the most recently uploaded document (a PDF or Word file the user just sent " +
      "in chat, which appears in your context as '[Document: ...]') into the user's " +
      "searchable cloud archive so it can be found later by the deep_research tool. Call " +
      "this when the user asks you to remember, save, or index a document they just " +
      "uploaded — the backend already has its extracted text server-side, so you don't " +
      "supply it. Optionally pass a title to override the filename.",
    parameters: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional short title to use instead of the document's filename"),
    }),
    execute: async ({ title }) => indexDocument(title),
  })
}
