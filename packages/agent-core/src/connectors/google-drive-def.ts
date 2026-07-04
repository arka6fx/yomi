import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

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

const EXPORT_TARGETS: Record<string, Record<string, string>> = {
  "application/vnd.google-apps.document": {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    html: "text/html",
    epub: "application/epub+zip",
    odt: "application/vnd.oasis.opendocument.text",
    rtf: "application/rtf",
  },
  "application/vnd.google-apps.spreadsheet": {
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    tsv: "text/tab-separated-values",
  },
  "application/vnd.google-apps.presentation": {
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
  },
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
    // DELETE returns 204 No Content — don't try to parse JSON.
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
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
        "This connector has full Drive access, so it can search the user's entire Google Drive.",
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
                "No files matched that query. Try a broader search term, or check the file exists in this Google account's Drive.",
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
        "Create a new Google Doc with text content. Returns the new file ID and direct link. Use drive-convertFile to convert it to PDF, DOCX, or other formats.",
      parameters: z.object({
        name: z.string().describe("Name of the new document"),
        content: z.string().describe("Plain text content for the document"),
        folderId: z.string().optional().describe("Optional folder ID to create the file in"),
      }),
      execute: async (args) => {
        const { name, content, folderId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-createFile",
            risk: "write",
            title: `Create Google Doc: ${name}`,
            preview: `${name}\n\n${content.slice(0, 500)}`,
            confirmText: "Create document",
          },
          args,
          async () => {
            try {
              const token = await ctx.getAccessToken(ctx.userId, "google-drive")

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
        )
      },
    }),

    "drive-updateFile": tool({
      description:
        "Rename a Google Drive file and/or move it between folders. Get the fileId from drive-searchFiles or drive-listFiles first.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID"),
        name: z.string().optional().describe("New file name"),
        addToFolderId: z.string().optional().describe("Folder ID to move the file into"),
        removeFromFolderId: z.string().optional().describe("Folder ID to remove the file from (e.g. its current parent)"),
      }),
      execute: async (args) => {
        const { fileId, name, addToFolderId, removeFromFolderId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-updateFile",
            risk: "write",
            title: `Update Drive file ${fileId}`,
            preview: [
              name ? `New name: ${name}` : null,
              addToFolderId ? `Move to folder: ${addToFolderId}` : null,
            ].filter(Boolean).join("\n"),
            confirmText: "Update file",
          },
          args,
          async () => {
            try {
              const params = new URLSearchParams({ fields: "id,name,webViewLink,parents" })
              if (addToFolderId) params.set("addParents", addToFolderId)
              if (removeFromFolderId) params.set("removeParents", removeFromFolderId)
              const body: Record<string, unknown> = {}
              if (name !== undefined) body["name"] = name
              const file = await driveJson<{ id: string; name: string; webViewLink?: string }>(
                `/files/${fileId}?${params}`,
                { method: "PATCH", body: JSON.stringify(body) },
              )
              return { ok: true, id: file.id, name: file.name, link: file.webViewLink, message: "File updated." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "drive-deleteFile": tool({
      description:
        "Delete a Google Drive file. By default moves it to Trash (recoverable for ~30 days); set permanent=true to delete it forever. IMPORTANT: Always confirm with the user before calling this.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID to delete"),
        permanent: z
          .boolean()
          .default(false)
          .describe("If true, permanently delete (cannot be undone). Otherwise move to Trash."),
      }),
      execute: async (args) => {
        const { fileId, permanent } = args
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-deleteFile",
            risk: permanent ? "irreversible" : "write",
            title: permanent ? `Permanently delete Drive file ${fileId}` : `Trash Drive file ${fileId}`,
            preview: `${permanent ? "Permanently delete" : "Move to Trash"} file ${fileId}.${permanent ? " This CANNOT be undone." : ""}`,
            confirmText: permanent ? "Delete permanently" : "Move to trash",
          },
          args,
          async () => {
            try {
              if (permanent) {
                await driveJson(`/files/${fileId}`, { method: "DELETE" })
                return { ok: true, message: `File ${fileId} permanently deleted.` }
              }
              await driveJson(`/files/${fileId}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) })
              return { ok: true, message: `File ${fileId} moved to Trash (recoverable).` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "drive-shareFile": tool({
      description: "Share a Google Drive file with specific users or make it accessible via a link. Set role to 'reader', 'commenter', or 'writer'.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID to share"),
        emailAddress: z.string().optional().describe("Email of the user to share with. Omit to create a shareable link."),
        role: z.enum(["reader", "commenter", "writer"]).default("reader").describe("Permission level"),
        sendNotificationEmail: z.boolean().default(true).describe("Whether to send a notification email"),
      }),
      execute: async (args) => {
        const { fileId, emailAddress, role, sendNotificationEmail } = args
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-shareFile",
            risk: "write",
            title: `Share Drive file ${fileId}`,
            preview: [
              `File ID: ${fileId}`,
              emailAddress ? `Invite: ${emailAddress} (${role})` : `Create shareable link (${role})`,
            ].filter(Boolean).join("\n"),
            confirmText: "Share file",
          },
          args,
          async () => {
            try {
              const token = await ctx.getAccessToken(ctx.userId, "google-drive")

              if (emailAddress) {
                const res = await fetch(
                  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=${sendNotificationEmail}&fields=id`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      type: "user",
                      role,
                      emailAddress,
                    }),
                  },
                )
                if (!res.ok) throw new Error(`Share failed: ${res.status}: ${await res.text()}`)
                const perm = (await res.json()) as { id: string }
                return { ok: true, permissionId: perm.id, message: `Shared with ${emailAddress} as ${role}.` }
              }

              const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=id`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    type: "anyone",
                    role,
                  }),
                },
              )
              if (!res.ok) throw new Error(`Share failed: ${res.status}: ${await res.text()}`)
              const perm = (await res.json()) as { id: string }
              return { ok: true, permissionId: perm.id, message: `Anyone with the link can ${role}.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "drive-copyFile": tool({
      description:
        "Copy (duplicate) a Google Drive file. Optionally specify a new name and target folder. Returns the new file's ID and link.",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID to copy"),
        name: z.string().optional().describe("New name for the copy. Defaults to 'Copy of <original>'"),
        parentFolderId: z.string().optional().describe("Folder ID to place the copy in"),
      }),
      execute: async (args) => {
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-copyFile",
            risk: "write",
            title: `Copy Drive file ${args.fileId}`,
            preview: args.name ? `Copy as "${args.name}"` : "Create a copy",
            confirmText: "Copy file",
          },
          args,
          async () => {
            try {
              const { fileId, name, parentFolderId } = args
              const body: Record<string, unknown> = {}
              if (name) body.name = name
              if (parentFolderId) body.parents = [parentFolderId]
              const file = await driveJson<{ id: string; name: string; webViewLink?: string }>(
                `/files/${encodeURIComponent(fileId)}/copy?fields=id,name,webViewLink`,
                { method: "POST", body: JSON.stringify(body) },
              )
              return { ok: true, id: file.id, name: file.name, link: file.webViewLink }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "drive-convertFile": tool({
      description:
        "Convert a Google Workspace file (Doc, Sheet, Slide) to another format like PDF, DOCX, XLSX, PPTX, TXT, CSV, HTML, EPUB, ODS, ODT, RTF, TSV. " +
        "Creates a new Drive file with the converted content. Use this when the user asks to convert a file to a different format.",
      parameters: z.object({
        fileId: z.string().describe("Drive file ID of the Google Doc/Sheet/Slide to convert"),
        targetFormat: z
          .enum(["pdf", "docx", "xlsx", "pptx", "txt", "csv", "html", "epub", "ods", "odt", "rtf", "tsv"])
          .describe("Target format"),
        name: z.string().optional().describe("Name for the converted file (defaults to original name + extension)"),
        folderId: z.string().optional().describe("Optional folder ID to place the converted file in"),
      }),
      execute: async (args) => {
        const { fileId, targetFormat, name, folderId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-convertFile",
            risk: "write",
            title: `Convert Drive file to ${targetFormat.toUpperCase()}`,
            preview: `Convert file ${fileId} to .${targetFormat}`,
            confirmText: "Convert",
          },
          args,
          async () => {
            try {
              const token = await ctx.getAccessToken(ctx.userId, "google-drive")

              const meta = await driveJson<{ id: string; name: string; mimeType: string }>(
                `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
              )

              const targets = EXPORT_TARGETS[meta.mimeType]
              if (!targets) {
                return {
                  error: `File "${meta.name}" (${fileTypeLabel(meta.mimeType)}) cannot be converted. Only Google Docs, Sheets, and Slides are supported.`,
                }
              }

              const targetMime = targets[targetFormat]
              if (!targetMime) {
                const supported = Object.keys(targets).join(", ")
                return {
                  error: `Format .${targetFormat} is not supported for ${fileTypeLabel(meta.mimeType)}. Supported formats: ${supported}`,
                }
              }

              const exportRes = await fetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(targetMime)}`,
                { headers: { Authorization: `Bearer ${token}` } },
              )
              if (!exportRes.ok) {
                const body = await exportRes.text()
                throw new Error(`Export failed: ${exportRes.status}: ${body.slice(0, 200)}`)
              }

              const buffer = await exportRes.arrayBuffer()
              const ext = targetFormat
              const newName = name ?? `${meta.name}.${ext}`
              const metadata: Record<string, unknown> = { name: newName, mimeType: targetMime }
              if (folderId) metadata.parents = [folderId]

              const encoder = new TextEncoder()
              const boundary = "yomi_convert_boundary"
              const metaJson = JSON.stringify(metadata)
              const head = encoder.encode(
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${targetMime}\r\n\r\n`,
              )
              const tail = encoder.encode(`\r\n--${boundary}--`)
              const body = new Blob([head, new Uint8Array(buffer), tail])

              const uploadRes = await fetch(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": `multipart/related; boundary=${boundary}`,
                  },
                  body,
                },
              )
              if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}: ${await uploadRes.text()}`)
              const file = (await uploadRes.json()) as { id: string; name: string; webViewLink: string; mimeType: string; size?: string }
              return {
                ok: true,
                id: file.id,
                name: file.name,
                format: targetFormat,
                type: fileTypeLabel(targetMime),
                link: file.webViewLink,
                message: `Converted to ${targetFormat.toUpperCase()}: ${file.name}`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "drive-listPermissions": tool({
      description: "List all users and groups who have access to a Google Drive file, along with their role (reader, commenter, writer, owner).",
      parameters: z.object({
        fileId: z.string().describe("Google Drive file ID"),
      }),
      execute: async ({ fileId }) => {
        try {
          const data = await driveJson<{
            permissions?: {
              id: string
              type: string
              role: string
              emailAddress?: string
              displayName?: string
              domain?: string
              deleted?: boolean
            }[]
          }>(`/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role,emailAddress,displayName,domain,deleted)&pageSize=100`)
          const perms = (data.permissions ?? []).map((p) => ({
            id: p.id,
            type: p.type, // "user", "group", "domain", "anyone"
            role: p.role,
            email: p.emailAddress ?? null,
            name: p.displayName ?? null,
            domain: p.domain ?? null,
            deleted: p.deleted ?? false,
          }))
          if (perms.length === 0) return { permissions: [], message: "No permissions found." }
          return { count: perms.length, permissions: perms }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "drive-createFolder": tool({
      description: "Create a new folder in Google Drive. Optionally specify a parent folder to nest it inside.",
      parameters: z.object({
        name: z.string().describe("Name of the new folder"),
        parentFolderId: z.string().optional().describe("ID of the parent folder to create this folder in"),
      }),
      execute: async (args) => {
        const { name, parentFolderId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-drive",
            action: "drive-createFolder",
            risk: "write",
            title: `Create Drive folder: ${name}`,
            preview: `Create folder "${name}"${parentFolderId ? ` inside ${parentFolderId}` : ""}`,
            confirmText: "Create folder",
          },
          args,
          async () => {
            try {
              const metadata: Record<string, unknown> = {
                name,
                mimeType: "application/vnd.google-apps.folder",
              }
              if (parentFolderId) metadata.parents = [parentFolderId]

              const file = await driveJson<{ id: string; name: string; webViewLink?: string }>("/files", {
                method: "POST",
                body: JSON.stringify(metadata),
              })
              return {
                ok: true,
                id: file.id,
                name: file.name,
                link: file.webViewLink,
                message: `Folder "${name}" created.`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),
  }
}

export const googleDriveDef: ConnectorDef = {
  id: "google-drive",
  name: "Google Drive",
  category: "file-storage",
  icon: "google-drive",
  description: "Search, read, create, convert, and manage files in Google Drive. Creates Google Docs; converts between formats (PDF, DOCX, XLSX, PPTX, TXT, CSV, HTML, EPUB, ODS, ODT, RTF, TSV).",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // Full Drive access (read, create, edit, delete any file). Broadest Drive
      // scope and "restricted" — requires Google CASA verification for public
      // release, or test-user allowlisting for personal use.
      "https://www.googleapis.com/auth/drive",
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
      "Uses full drive scope (restricted): add your email under OAuth consent screen → Test users for personal use, or complete Google CASA verification to release to all users",
    ],
    collect: [
      { env: "GOOGLE_INTEGRATIONS_CLIENT_ID", label: "Google Client ID", secret: false },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/drive/api/quickstart",
  },
  tools: createDriveTools,
}
