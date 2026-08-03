import { tool } from "ai"
import { z } from "zod"

export type IndexDocumentResult =
  | { ok: true; documentId: string; warning?: string }
  | { error: string }
export type IndexDocumentFn = (title: string, content: string) => Promise<IndexDocumentResult>

export function createIndexDocumentTool(indexDocument: IndexDocumentFn) {
  return tool({
    description:
      "Index an uploaded document's content into the user's searchable cloud archive " +
      "so it can be found later by the deep_research tool. Use this when the user has " +
      "uploaded a PDF or Word document (its content will appear in your context as " +
      "'[Document: ...]') and asks you to remember, save, or index it. Very large " +
      "documents (roughly beyond a 5-page PDF) may not fit fully in this tool call — " +
      "if the result includes a warning, tell the user the indexed content may be a " +
      "partial capture of the original document.",
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
