import { getAccessToken } from "./integration-tokens.js"

// Extract text from binary documents (PDF, DOCX) using Google Drive's import
// conversion: upload as a temporary Google Doc (Drive OCRs PDFs), export it as
// plain text, then delete the temp file. Chosen over bundling a PDF parser
// because pdf.js-class libraries blow the Worker bundle budget; Drive does the
// heavy lifting server-side and the user's Drive token is already available.
// Returns null when the user has no Drive connection or conversion fails.
export async function extractTextViaDrive(
  userId: string,
  bytes: ArrayBuffer,
  sourceMime: string,
  name: string,
): Promise<string | null> {
  let token: string
  try {
    token = await getAccessToken(userId, "google-drive")
  } catch {
    return null // Drive not connected — caller falls back to filename-only context
  }

  const metadata = {
    name: `[yomi temp] parsing ${name}`.slice(0, 120),
    mimeType: "application/vnd.google-apps.document",
  }
  const boundary = `yomi_parse_${Date.now()}`
  const pre =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${sourceMime}\r\n\r\n`
  const post = `\r\n--${boundary}--`

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Blob([pre, bytes, post]),
    },
  )
  if (!uploadRes.ok) {
    console.warn(`[document-extract] drive import failed: ${uploadRes.status}`)
    return null
  }
  const file = (await uploadRes.json()) as { id: string }

  try {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!exportRes.ok) {
      console.warn(`[document-extract] export failed: ${exportRes.status}`)
      return null
    }
    const text = await exportRes.text()
    return text.trim() ? text.slice(0, 50_000) : null
  } finally {
    // Always remove the temp file — it exists only to run the conversion.
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
}
