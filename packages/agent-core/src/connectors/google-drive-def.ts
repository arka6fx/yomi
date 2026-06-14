import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"

export function createDriveTools(ctx: ConnectorContext): ToolSet {
  async function drive<T>(path: string, init?: RequestInit): Promise<T> {
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

  return {
    "drive.searchFiles": tool({
      description:
        "Search for files in the user's Google Drive. Supports searching by name, type, or content. Only searches files the app created or that the user opened with this app (drive.file scope).",
      parameters: z.object({
        query: z
          .string()
          .describe(
            "Search query. Supports Drive query syntax, e.g. \"name contains 'budget'\" or \"mimeType='application/pdf'\"",
          ),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results to return"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const params = new URLSearchParams({
            q: query,
            pageSize: String(limit),
            fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
          })
          const data = await drive<{
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
          if (files.length === 0) return { files: [], message: "No files found matching the query." }
          return {
            count: files.length,
            files: files.map((f) => ({
              id: f.id,
              name: f.name,
              type: f.mimeType,
              size: f.size ? `${Math.round(Number(f.size) / 1024)} KB` : undefined,
              modified: f.modifiedTime,
              link: f.webViewLink,
            })),
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Search failed" }
        }
      },
    }),

    "drive.getFile": tool({
      description: "Get metadata and a view link for a specific Google Drive file by its ID.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID"),
      }),
      execute: async ({ fileId }) => {
        try {
          const file = await drive<{
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
            type: file.mimeType,
            size: file.size ? `${Math.round(Number(file.size) / 1024)} KB` : undefined,
            modified: file.modifiedTime,
            created: file.createdTime,
            link: file.webViewLink,
            description: file.description,
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch file" }
        }
      },
    }),

    "drive.listFiles": tool({
      description:
        "List files in the user's Google Drive, optionally filtered by folder. Returns the most recently modified files.",
      parameters: z.object({
        folderId: z
          .string()
          .optional()
          .describe("Google Drive folder ID. Omit to list from the root/Drive home."),
        limit: z.number().int().min(1).max(20).default(10).describe("Max files to return"),
      }),
      execute: async ({ folderId, limit }) => {
        try {
          const q = folderId ? `'${folderId}' in parents` : "trashed = false"
          const params = new URLSearchParams({
            q,
            pageSize: String(limit),
            orderBy: "modifiedTime desc",
            fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
          })
          const data = await drive<{
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
              type: f.mimeType,
              modified: f.modifiedTime,
              link: f.webViewLink,
            })),
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to list files" }
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
  description: "Search and access files in your Google Drive.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // drive.file is non-restricted; avoids the annual CASA audit from drive.readonly
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
      "Use the same Google Cloud project as Gmail (GOOGLE_INTEGRATIONS_CLIENT_ID)",
      "Enable Google Drive API under APIs & Services → Library",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-drive",
      "Using drive.file scope (non-restricted — no CASA audit needed)",
    ],
    collect: [
      { env: "GOOGLE_INTEGRATIONS_CLIENT_ID", label: "Google Client ID (same as Gmail)", secret: false },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/drive/api/quickstart",
  },
  tools: createDriveTools,
}
