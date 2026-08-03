import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult = { ok: true; documentId: string } | { error: string }
export type IndexDocumentFn = (title: string, content: string) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index an uploaded document's content into the user's searchable cloud archive " +
      "so it can be found later by the deep_research tool. Use this when the user has " +
      "uploaded a PDF or Word document (its content will appear in your context as " +
      "'[Document: ...]') and asks you to remember, save, or index it.",
    parameters: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .describe("A short, descriptive title — typically the document's filename"),
      content: z.string().min(1).max(100_000).describe("The document's extracted text content"),
    }),
    execute: async ({ title, content }) => indexDocument(title, content),
  })
}
