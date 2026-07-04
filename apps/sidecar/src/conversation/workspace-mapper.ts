const WORKSPACE_KEYWORDS: Record<string, { app: string; toolPrefix: string; entityType: string }> = {
  slide: { app: "Google Slides", toolPrefix: "google-slides", entityType: "slides_presentation" },
  slides: { app: "Google Slides", toolPrefix: "google-slides", entityType: "slides_presentation" },
  presentation: { app: "Google Slides", toolPrefix: "google-slides", entityType: "slides_presentation" },
  ppt: { app: "Google Slides", toolPrefix: "google-slides", entityType: "slides_presentation" },
  deck: { app: "Google Slides", toolPrefix: "google-slides", entityType: "slides_presentation" },

  document: { app: "Google Docs", toolPrefix: "google-docs", entityType: "drive_doc" },
  doc: { app: "Google Docs", toolPrefix: "google-docs", entityType: "drive_doc" },

  spreadsheet: { app: "Google Sheets", toolPrefix: "google-sheets", entityType: "drive_doc" },
  sheet: { app: "Google Sheets", toolPrefix: "google-sheets", entityType: "drive_doc" },
  excel: { app: "Google Sheets", toolPrefix: "google-sheets", entityType: "drive_doc" },

  folder: { app: "Google Drive", toolPrefix: "google-drive", entityType: "drive_folder" },
  directory: { app: "Google Drive", toolPrefix: "google-drive", entityType: "drive_folder" },
}

const DOCUMENT_WORDS = new Set([
  "document", "doc", "docs",
  "spreadsheet", "sheet", "excel",
  "slide", "slides", "presentation", "ppt", "deck",
  "folder", "directory",
])

export interface WorkspaceMapping {
  app: string
  toolPrefix: string
  entityType: string
  keyword: string
}

export function inferWorkspace(text: string): WorkspaceMapping | undefined {
  const lower = text.toLowerCase()
  for (const [keyword, mapping] of Object.entries(WORKSPACE_KEYWORDS)) {
    if (lower.includes(keyword)) return { ...mapping, keyword }
  }
  return undefined
}

export function isDocumentRequest(text: string): boolean {
  const lower = text.toLowerCase()
  return [...DOCUMENT_WORDS].some((w) => {
    const regex = new RegExp(`\\b${w}\\b`, "i")
    return regex.test(lower)
  })
}
