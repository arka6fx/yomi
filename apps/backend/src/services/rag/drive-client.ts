import { getAccessToken } from "../integration-tokens.js"

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  webViewLink?: string
  trashed?: boolean
}
export interface DriveChange {
  fileId: string
  removed: boolean
  file?: DriveFile
}
export interface DriveClient {
  listFolderChildren(
    userId: string,
    folderId: string,
    pageToken?: string,
    pageSize?: number,
  ): Promise<{ files: DriveFile[]; nextPageToken?: string }>
  fetchContent(
    userId: string,
    fileId: string,
    kind: "export" | "media",
    mimeType?: string,
  ): Promise<string>
  getStartPageToken(userId: string): Promise<string>
  listChanges(
    userId: string,
    pageToken: string,
  ): Promise<{ changes: DriveChange[]; newStartPageToken?: string; nextPageToken?: string }>
}

export class DriveApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = "DriveApiError"
  }
}

type FetchFn = typeof fetch

const BASE = "https://www.googleapis.com/drive/v3"
const FILE_FIELDS = "id,name,mimeType,parents,webViewLink,trashed"

export function makeDriveClient(fetchImpl: FetchFn = fetch): DriveClient {
  async function authed(userId: string, url: string): Promise<Response> {
    const token = await getAccessToken(userId, "google-drive")
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new DriveApiError(`Drive ${url} → ${res.status}: ${body.slice(0, 200)}`, res.status)
    }
    return res
  }

  return {
    async listFolderChildren(userId, folderId, pageToken, pageSize) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: String(pageSize ?? 100),
        fields: `nextPageToken, files(${FILE_FIELDS})`,
      })
      if (pageToken) params.set("pageToken", pageToken)
      const res = await authed(userId, `${BASE}/files?${params}`)
      const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string }
      return { files: data.files ?? [], nextPageToken: data.nextPageToken }
    },

    async fetchContent(userId, fileId, kind, mimeType) {
      const url =
        kind === "export"
          ? `${BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType ?? "text/plain")}`
          : `${BASE}/files/${encodeURIComponent(fileId)}?alt=media`
      const res = await authed(userId, url)
      return res.text()
    },

    async getStartPageToken(userId) {
      const res = await authed(userId, `${BASE}/changes/startPageToken`)
      const data = (await res.json()) as { startPageToken?: string }
      if (!data.startPageToken) throw new DriveApiError("no startPageToken", 500)
      return data.startPageToken
    },

    async listChanges(userId, pageToken) {
      const params = new URLSearchParams({
        pageToken,
        pageSize: "100",
        fields: `newStartPageToken, nextPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
      })
      const res = await authed(userId, `${BASE}/changes?${params}`)
      const data = (await res.json()) as {
        changes?: DriveChange[]
        newStartPageToken?: string
        nextPageToken?: string
      }
      return {
        changes: data.changes ?? [],
        newStartPageToken: data.newStartPageToken,
        nextPageToken: data.nextPageToken,
      }
    },
  }
}

export const realDriveClient: DriveClient = makeDriveClient()
