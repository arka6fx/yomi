export type ExtractResult = { text: string } | { skipped: true; reason: string }
export type DriveFetch = (kind: "export" | "media", mimeType?: string) => Promise<string>

const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
}

function isDownloadable(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json"
}

export async function driveExtract(
  file: { mimeType: string },
  fetchFile: DriveFetch,
): Promise<ExtractResult> {
  const exportMime = EXPORT_MIME[file.mimeType]
  if (exportMime) {
    const text = await fetchFile("export", exportMime)
    return { text }
  }
  if (isDownloadable(file.mimeType)) {
    const text = await fetchFile("media")
    return { text }
  }
  return { skipped: true, reason: `unsupported:${file.mimeType}` }
}
