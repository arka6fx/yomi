import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

const GOOGLE_MIME_LABELS: Record<string, string> = {
  "application/vnd.google-apps.document": "Google Doc",
  "application/vnd.google-apps.spreadsheet": "Google Sheet",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google-apps.folder": "Folder",
  "application/vnd.google-apps.form": "Google Form",
  "application/vnd.google-apps.drawing": "Google Drawing",
  "application/pdf": "PDF",
  "text/plain": "Text file",
  "text/csv": "CSV",
  "text/markdown": "Markdown",
  "application/json": "JSON",
}

// Which Google Workspace types can be exported to plain text / CSV
const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
}

function fileTypeLabel(mimeType: string): string {
  return GOOGLE_MIME_LABELS[mimeType] ?? mimeType.split("/").pop() ?? "File"
}

export function createDriveTools(ctx: ConnectorContext): ToolSet {
  async function driveJson<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "google-drive")
    const base = "https://www.googleapis.com/drive/v3"
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Drive API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  async function driveRaw(path: string): Promise<Response> {
    const token = await ctx.getAccessToken(ctx.userId, "google-drive")
    const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Drive API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    return res
  }

  return {
    "drive-getStorageQuota": tool({
      description:
        "Get the user's Google Drive storage usage and remaining free space. " +
        "Use this when the user asks how much Drive space is left, how full their Drive is, " +
        "or how much storage they've used. Returns bytes used, total limit, and free space.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const data = await driveJson<{
            storageQuota?: {
              limit?: string
              usage?: string
              usageInDrive?: string
              usageInDriveTrash?: string
            }
          }>("/about?fields=storageQuota")
          const q = data.storageQuota ?? {}
          const usage = q.usage ? Number(q.usage) : null
          const limit = q.limit ? Number(q.limit) : null
          const fmt = (bytes: number | null): string | null => {
            if (bytes === null || Number.isNaN(bytes)) return null
            const units = ["B", "KB", "MB", "GB", "TB"]
            let n = bytes
            let i = 0
            while (n >= 1024 && i < units.length - 1) {
              n /= 1024
              i++
            }
            return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
          }
          const free = limit !== null && usage !== null ? Math.max(0, limit - usage) : null
          return {
            used: fmt(usage),
            total: limit === null ? "unlimited" : fmt(limit),
            free: limit === null ? "unlimited" : fmt(free),
            percentUsed: limit !== null && usage !== null && limit > 0 ? Math.round((usage / limit) * 100) : null,
            usedBytes: usage,
            limitBytes: limit,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "drive-searchFiles": tool({
      description:
        "Search for files in the user's Google Drive by name or type. " +
        "Returns file names, types, last modified date, and direct view links. " +
        "Always include the link in your response. " +
        "Note: only files the user has opened with or created via this app are accessible (drive.file scope).",
      parameters: z.object({
        query: z
          .string()
          .describe(
            "Search query using Drive query syntax. Examples: \"name contains 'budget'\", \"mimeType='application/pdf'\", \"name contains 'report' and mimeType='application/vnd.google-apps.document'\"",
          ),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results to return"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const params = new URLSearchParams({
            q: query,
            pageSize: String(limit),
            orderBy: "modifiedTime desc",
            fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
          })
          const data = await driveJson<{
            files?: {
              id: string
              name: string
              mimeType: string
              size?: string
              modifiedTime: string
              webViewLink?: string
            }[]
          }>(`/files?${params}`)
          const files = data.files ?? []
          if (files.length === 0) {
            return {
              files: [],
              message:
                "No files found. This connector uses drive.file scope, which only sees files you've opened or created through Yomi. " +
                "To access a file, open it in Google Drive and use 'Open with → Yomi', or ask Yomi to create a new file.",
            }
          }
          return {
            count: files.length,
            files: files.map((f) => ({
              id: f.id,
              name: f.name,
              type: fileTypeLabel(f.mimeType),
              mimeType: f.mimeType,
              size: f.size ? `${Math.round(Number(f.size) / 1024)} KB` : undefined,
              modified: f.modifiedTime,
              link: f.webViewLink,
            })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "drive-listFiles": tool({
      description:
        "List files in the user's Google Drive, sorted by most recently modified. " +
        "Optionally filter to a specific folder. Always include file links in your response.",
      parameters: z.object({
        folderId: z
          .string()
          .optional()
          .describe("Google Drive folder ID to list. Omit to list all accessible files."),
        limit: z.number().int().min(1).max(20).default(10).describe("Max files to return"),
      }),
      execute: async ({ folderId, limit }) => {
        try {
          const q = folderId ? `'${folderId}' in parents and trashed = false` : "trashed = false"
          const params = new URLSearchParams({
            q,
            pageSize: String(limit),
            orderBy: "modifiedTime desc",
            fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
          })
          const data = await driveJson<{
            files?: {
              id: string
              name: string
              mimeType: string
              size?: string
              modifiedTime: string
              webViewLink?: string
            }[]
          }>(`/files?${params}`)
          const files = data.files ?? []
          if (files.length === 0) return { files: [], message: "No files found." }
          return {
            count: files.length,
            files: files.map((f) => ({
              id: f.id,
              name: f.name,
              type: fileTypeLabel(f.mimeType),
              mimeType: f.mimeType,
              modified: f.modifiedTime,
              link: f.webViewLink,
            })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "drive-getFile": tool({
      description:
        "Get metadata for a specific Google Drive file by ID: name, type, size, created/modified dates, and direct view link. " +
        "Use drive-readFile to also get the text content.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID"),
      }),
      execute: async ({ fileId }) => {
        try {
          const file = await driveJson<{
            id: string
            name: string
            mimeType: string
            size?: string
            modifiedTime: string
            createdTime: string
            webViewLink?: string
            description?: string
          }>(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime,createdTime,webViewLink,description`)
          return {
            id: file.id,
            name: file.name,
            type: fileTypeLabel(file.mimeType),
            mimeType: file.mimeType,
            size: file.size ? `${Math.round(Number(file.size) / 1024)} KB` : undefined,
            modified: file.modifiedTime,
            created: file.createdTime,
            link: file.webViewLink,
            description: file.description,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "drive-readFile": tool({
      description:
        "Read the actual text content of a Google Drive file. " +
        "Works for Google Docs (exported as plain text), Google Sheets (exported as CSV), " +
        "Google Slides (exported as plain text), and plain text/JSON/CSV files. " +
        "Use this when the user asks what a file contains, to summarize it, or to answer questions about its content.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID"),
      }),
      execute: async ({ fileId }) => {
        try {
          const meta = await driveJson<{
            id: string
            name: string
            mimeType: string
            webViewLink?: string
            size?: string
          }>(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,size`)

          const exportMime = EXPORT_MIME[meta.mimeType]
          let content: string

          if (exportMime) {
            // Google Workspace file — use export API
            const res = await driveRaw(
              `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
            )
            content = await res.text()
          } else if (
            meta.mimeType.startsWith("text/") ||
            meta.mimeType === "application/json"
          ) {
            // Plain text / JSON — download directly
            const res = await driveRaw(`/files/${encodeURIComponent(fileId)}?alt=media`)
            content = await res.text()
          } else {
            // Binary file — can't read, return metadata + link
            return {
              id: meta.id,
              name: meta.name,
              type: fileTypeLabel(meta.mimeType),
              link: meta.webViewLink,
              message: `Cannot read binary file (${fileTypeLabel(meta.mimeType)}). Open it directly: ${meta.webViewLink}`,
            }
          }

          const trimmed = content.slice(0, 12000)
          return {
            id: meta.id,
            name: meta.name,
            type: fileTypeLabel(meta.mimeType),
            link: meta.webViewLink,
            content: trimmed,
            truncated: content.length > 12000,
            charCount: content.length,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "drive-createFile": tool({
      description:
        "Create a new Google Doc with text content. Returns the new file ID and direct link.",
      parameters: z.object({
        name: z.string().describe("Name of the new document"),
        content: z.string().describe("Plain text content for the document"),
        folderId: z.string().optional().describe("Optional folder ID to create the file in"),
      }),
      execute: async ({ name, content, folderId }) => {
        try {
          const token = await ctx.getAccessToken(ctx.userId, "google-drive")

          // Create a Google Doc via multipart upload
          const metadata: Record<string, unknown> = {
            name,
            mimeType: "application/vnd.google-apps.document",
          }
          if (folderId) metadata.parents = [folderId]

          const boundary = "yomi_boundary_xyz"
          const body = [
            `--${boundary}`,
            "Content-Type: application/json; charset=UTF-8",
            "",
            JSON.stringify(metadata),
            `--${boundary}`,
            "Content-Type: text/plain; charset=UTF-8",
            "",
            content,
            `--${boundary}--`,
          ].join("\r\n")

          const res = await fetch(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": `multipart/related; boundary=${boundary}`,
              },
              body,
            },
          )
          if (!res.ok) throw new Error(`Create failed: ${res.status}: ${await res.text()}`)
          const file = (await res.json()) as { id: string; name: string; webViewLink: string }
          return { id: file.id, name: file.name, link: file.webViewLink }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const googleDriveDef: ConnectorDef = {
  id: "google-drive",
  name: "Google Drive",
  category: "file-storage",
  icon: "google-drive",
  description: "Search, read, and create files in Google Drive. Reads Google Docs, Sheets, and Slides content.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google-drive",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Enable Google Drive API under APIs & Services → Library",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-drive",
      "Using drive.file scope (non-restricted — no CASA audit needed)",
    ],
    collect: [
      { env: "GOOGLE_INTEGRATIONS_CLIENT_ID", label: "Google Client ID", secret: false },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/drive/api/quickstart",
  },
  tools: createDriveTools,
}
