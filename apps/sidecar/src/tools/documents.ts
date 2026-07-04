import { tool, jsonSchema } from "ai"
import { Buffer } from "node:buffer"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

type DocResult = { text: string; error?: never } | { error: string; text?: never }

async function downloadFile(url: string, maxBytes = 30 * 1024 * 1024): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength > maxBytes) throw new Error(`File too large (${(bytes.byteLength / 1024 / 1024).toFixed(0)} MB, max ${maxBytes / 1024 / 1024} MB)`)
  return bytes
}

function mimeOf(url: string, mime?: string): string {
  if (mime) return mime.toLowerCase()
  const ext = url.split(".").pop()?.toLowerCase()
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    csv: "text/csv",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    json: "application/json",
    xml: "text/xml",
    rtf: "application/rtf",
  }
  return map[ext ?? ""] ?? "application/octet-stream"
}

async function parseText(bytes: ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(bytes).slice(0, 100_000)
}

async function parseHtml(bytes: ArrayBuffer): Promise<string> {
  const raw = new TextDecoder().decode(bytes)
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000)
}

async function parsePdf(bytes: ArrayBuffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse")
  const parser = new (PDFParse as any)({ data: Buffer.from(bytes) })
  await (parser as any).load()
  const pages = await (parser as any).getText()
  const text = (Array.isArray(pages) ? pages.join("\n") : String(pages)).trim()
  return text.slice(0, 100_000)
}

async function parseDocx(bytes: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return result.value?.trim()?.slice(0, 100_000) ?? ""
}

async function parseXlsx(bytes: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx")
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" })
  const lines: string[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    if (csv.trim()) {
      lines.push(`--- Sheet: ${name} ---`)
      lines.push(csv.trim())
    }
  }
  return lines.join("\n").slice(0, 100_000)
}

async function parsePptx(bytes: ArrayBuffer): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "yomi-pptx-"))
  const tmpFile = join(tmpDir, "input.pptx")
  await writeFile(tmpFile, Buffer.from(bytes))
  try {
    const mod = await import("node-pptx-parser")
    const PptxParser = (mod as any).default ?? mod
    const parser = new PptxParser(tmpFile)
    const result = await parser.parse()
    const slides: string[] = []
    if (Array.isArray(result)) {
      for (const slide of result) {
        const texts: string[] = []
        if (slide.texts && Array.isArray(slide.texts)) {
          for (const t of slide.texts) {
            if (t.text) texts.push(t.text)
          }
        }
        if (slide.shapes && Array.isArray(slide.shapes)) {
          for (const shape of slide.shapes) {
            if (shape.text) texts.push(shape.text)
          }
        }
        if (texts.length) slides.push(texts.join("\n"))
      }
    }
    return slides.join("\n\n---\n\n").slice(0, 100_000)
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function extractText(url: string, mimeOverride?: string): Promise<DocResult> {
  const mime = mimeOf(url, mimeOverride)

  try {
    const bytes = await downloadFile(url)
    const MAX_TEXT = 100_000

    if (mime.includes("pdf")) {
      const text = await parsePdf(bytes)
      return text ? { text } : { error: "PDF parsing returned no text" }
    }
    if (mime.includes("wordprocessingml") || mime.includes("docx") || mime === "application/msword") {
      const text = await parseDocx(bytes)
      return text ? { text } : { error: "DOCX parsing returned no text" }
    }
    if (mime.includes("spreadsheet") || mime.includes("xlsx") || mime.includes("xls")) {
      const text = await parseXlsx(bytes)
      return text ? { text } : { error: "XLSX parsing returned no text" }
    }
    if (mime.includes("presentation") || mime.includes("pptx") || mime.includes("ppt")) {
      const text = await parsePptx(bytes)
      return text ? { text } : { error: "PPTX parsing returned no text" }
    }
    if (mime.includes("html")) {
      const text = await parseHtml(bytes)
      return text ? { text } : { error: "HTML parsing returned no text" }
    }
    if (mime.includes("text/") || mime.includes("json") || mime.includes("xml")) {
      const text = await parseText(bytes)
      return text ? { text } : { error: "Empty text file" }
    }
    if (mime.includes("rtf")) {
      const text = await parseText(bytes)
      return text ? { text } : { error: "Empty RTF file" }
    }

    return { error: `Unsupported format: ${mime}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export { extractText }

export function createDocumentTools() {
  return {
    read_document: tool({
      description:
        "Download and extract text content from a document file. Supports PDF, DOCX, XLSX, PPTX, " +
        "TXT, CSV, MD, HTML, JSON, XML, and RTF. Returns the extracted text (up to 100 KB) that " +
        "you can use for summarization, Q&A, data extraction, etc.",
      parameters: jsonSchema<{ url: string; mimeType?: string }>({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Direct download URL of the document file",
          },
          mimeType: {
            type: "string",
            description: "Optional MIME type hint if the URL doesn't indicate the format",
          },
        },
        required: ["url"],
      }),
      execute: async ({ url, mimeType }) => {
        return extractText(url, mimeType)
      },
    }),
  }
}
