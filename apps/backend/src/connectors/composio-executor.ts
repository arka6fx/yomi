import { createHash } from "node:crypto"
import type { ComposioExecutor } from "@yomi/agent-core"

// Raw-fetch Composio tool executor. Matches the native connectors' fetch style
// (no new npm dependency) and is the single place a Composio tool call leaves the
// backend. Reads COMPOSIO_API_KEY; the base URL is overridable for tests.
//
// REST: POST {base}/api/v3.1/tools/execute/{slug}
//   headers: x-api-key
//   body:    { user_id, version, arguments }
// Composio resolves the user's connected account for the toolkit from user_id.

const DEFAULT_BASE_URL = "https://backend.composio.dev"

// Wraps an executor with a per-turn call tally so the agent run can meter Composio
// usage (one execute == one billable Composio tool call). Built fresh per run in
// agent/run.ts; `count()` is read after the loop to charge credits + record cost.
export interface CountingComposioExecutor extends ComposioExecutor {
  count(): number
}

export function createCountingExecutor(inner: ComposioExecutor): CountingComposioExecutor {
  let n = 0
  return {
    count: () => n,
    execute: (input) => {
      // Count on invocation: every in-turn call reaches Composio, so each is a real
      // billable call. Gated writes run at approval REPLAY (a separate flow with its
      // own executor), so they are metered there — not by this per-turn counter.
      n++
      return inner.execute(input)
    },
    // Not counted: staging is a separate Composio API (file upload/request), not a
    // `tools/execute` call, so it doesn't consume the tool-calls quota the counter
    // exists to meter. The subsequent real tool execute() is what gets billed.
    stageFile: inner.stageFile ? (input) => inner.stageFile!(input) : undefined,
  }
}

export interface ComposioRestConfig {
  apiKey: string
  baseUrl?: string
  toolkitVersion?: string
  fetchImpl?: typeof fetch
}

export function composioBaseUrl(): string {
  return process.env["COMPOSIO_BASE_URL"] || DEFAULT_BASE_URL
}

// Best-effort filename from a URL's last path segment; Composio only uses this
// for display, so a generic fallback is fine when the URL has none (e.g. a bare
// presigned query string root).
function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").pop()
    return last && last.length > 0 ? decodeURIComponent(last) : "upload.bin"
  } catch {
    return "upload.bin"
  }
}

interface PresignedUploadResponse {
  key: string
  new_presigned_url: string
  metadata?: { storage_backend?: "s3" | "azure_blob_storage" }
}

// HTTP-level failures (bad user id, no connected account, invalid params) return
// `error` as an object ({ message, code, slug, status, request_id, suggested_fix }),
// confirmed live against backend.composio.dev — not the plain string the
// 200-but-successful:false path returns. Stringifying that object directly
// produced "[object Object]", discarding the one piece of information (why the
// call failed) that let the model tell a user "you're not connected" accurately
// instead of guessing it every time something else was actually wrong.
function errorDetail(errorField: unknown): string | null {
  if (typeof errorField === "string") return errorField
  if (errorField && typeof errorField === "object") {
    const e = errorField as { message?: unknown; suggested_fix?: unknown }
    if (typeof e.message === "string") {
      return typeof e.suggested_fix === "string" ? `${e.message} (${e.suggested_fix})` : e.message
    }
  }
  return null
}

export function createComposioRestExecutor(config?: Partial<ComposioRestConfig>): ComposioExecutor {
  const apiKey = config?.apiKey ?? process.env["COMPOSIO_API_KEY"] ?? ""
  const baseUrl = config?.baseUrl ?? composioBaseUrl()
  const toolkitVersion =
    config?.toolkitVersion ?? process.env["COMPOSIO_TOOLKIT_VERSION"] ?? "latest"
  const doFetch = config?.fetchImpl ?? fetch

  return {
    // Stages a file Composio's tools can consume without adopting their SDK: request
    // a presigned upload slot, PUT the bytes straight to their storage, hand back the
    // {name, mimetype, s3key} descriptor their `file_uploadable` params expect. Mirrors
    // what `composio.files.upload()` does internally (confirmed from their public
    // fileUtils.node.ts source) — this is the one piece of that convenience we need.
    async stageFile({ url, toolSlug, toolkitSlug }) {
      if (!apiKey) throw new Error("COMPOSIO_API_KEY not set")
      const sourceRes = await doFetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!sourceRes.ok) throw new Error(`Failed to fetch file to stage: ${sourceRes.status}`)
      const mimetype = sourceRes.headers.get("content-type") || "application/octet-stream"
      const bytes = new Uint8Array(await sourceRes.arrayBuffer())
      const filename = filenameFromUrl(url)
      const md5 = createHash("md5").update(bytes).digest("hex")

      const reqRes = await doFetch(`${baseUrl}/api/v3.1/files/upload/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          filename,
          mimetype,
          md5,
          tool_slug: toolSlug,
          toolkit_slug: toolkitSlug,
        }),
      })
      if (!reqRes.ok) {
        const detail = await reqRes.text().catch(() => "")
        throw new Error(
          `Composio file stage request failed: status ${reqRes.status}: ${detail.slice(0, 300)}`,
        )
      }
      const { key, new_presigned_url, metadata } = (await reqRes.json()) as PresignedUploadResponse

      const uploadHeaders: Record<string, string> = { "Content-Type": mimetype }
      if (metadata?.storage_backend === "azure_blob_storage") {
        uploadHeaders["x-ms-blob-type"] = "BlockBlob"
      }
      const uploadRes = await doFetch(new_presigned_url, {
        method: "PUT",
        body: bytes,
        headers: uploadHeaders,
      })
      if (!uploadRes.ok) {
        throw new Error(`Failed to upload staged file to storage: ${uploadRes.status}`)
      }

      return { name: filename, mimetype, s3key: key }
    },

    async execute({ userId, slug, arguments: args }) {
      if (!apiKey) throw new Error("COMPOSIO_API_KEY not set")
      const res = await doFetch(`${baseUrl}/api/v3.1/tools/execute/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ user_id: userId, version: toolkitVersion, arguments: args ?? {} }),
      })
      const text = await res.text()
      let body: unknown
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = { raw: text }
      }
      if (!res.ok) {
        const errorField =
          typeof body === "object" && body && "error" in body
            ? (body as { error: unknown }).error
            : undefined
        const detail = errorDetail(errorField) ?? text.slice(0, 300)
        throw new Error(`Composio execute ${slug} → status ${res.status}: ${detail}`)
      }
      // Composio wraps results as { data, error, successful }. Surface the useful
      // parts to the agent; a failed-but-200 response carries `error`.
      if (body && typeof body === "object") {
        const b = body as { data?: unknown; error?: unknown; successful?: boolean }
        if (b.successful === false || b.error) {
          return { error: b.error ? String(b.error) : "Composio tool call failed" }
        }
        if ("data" in b) return b.data
      }
      return body
    },
  }
}
