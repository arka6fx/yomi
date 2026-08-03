import { resolvesToDisallowedAddress } from "@yomi/agent-core"
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"
import { ensureSource } from "./source-lookup.js"

const URL_SOURCE_TYPE = "url"
const URL_SOURCE_NAME = "Indexed URLs"
const URL_SOURCE_PATH = "indexed-urls"

const MAX_BODY_BYTES = 2_000_000
const FETCH_TIMEOUT_MS = 10_000

export type UrlExtractResult =
  | { title: string; text: string; normalizedUrl: string }
  | { error: string }

function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.trim()
  return title || fallback
}

function stripHtml(html: string): string {
  return html
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Fetches a user-supplied URL and extracts its readable text. Never throws — every
// failure path (invalid URL, SSRF-blocked address, redirect, timeout, non-2xx, wrong
// content-type, oversized body) returns { error } with a specific, distinct message.
export async function fetchAndExtractUrl(rawUrl: string): Promise<UrlExtractResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { error: "only http and https URLs can be indexed" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "only http and https URLs can be indexed" }
  }
  url.hash = ""
  const normalizedUrl = url.toString()

  if (await resolvesToDisallowedAddress(url.hostname)) {
    return { error: "that URL cannot be fetched" }
  }

  let response: Response
  try {
    response = await fetch(normalizedUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return { error: "failed to fetch that URL" }
  }

  if (response.status >= 300 && response.status < 400) {
    return { error: "that URL redirects, which isn't supported yet" }
  }
  if (!response.ok) {
    return { error: `fetch failed with status ${response.status}` }
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return { error: "that page is too large to index" }
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
  const isHtml = contentType.startsWith("text/html")
  const isPlainText = contentType.startsWith("text/plain")
  if (!isHtml && !isPlainText) {
    return { error: "only HTML and plain-text pages can be indexed" }
  }

  let buffer: ArrayBuffer
  try {
    buffer = await response.arrayBuffer()
  } catch {
    return { error: "failed to fetch that URL" }
  }
  if (buffer.byteLength > MAX_BODY_BYTES) {
    return { error: "that page is too large to index" }
  }

  const raw = new TextDecoder().decode(buffer)
  if (isHtml) {
    return { title: extractTitle(raw, normalizedUrl), text: stripHtml(raw), normalizedUrl }
  }
  return { title: normalizedUrl, text: raw.trim(), normalizedUrl }
}

// Consent-gated wrapper: fetch + extract + index. Never throws, same reasoning as
// indexManualText — the whole body is guarded so a failure here can't kill the
// parent agent turn.
export async function indexUrl(
  userId: string,
  rawUrl: string,
): Promise<{ ok: true; documentId: string; title: string } | { error: string }> {
  try {
    const consent = await checkConsent(userId, "cloud_memory")
    if (!consent.allowed) {
      return {
        error: `cloud memory consent not granted${consent.reason ? `: ${consent.reason}` : ""}`,
      }
    }

    const extracted = await fetchAndExtractUrl(rawUrl)
    if ("error" in extracted) return extracted

    const sourceId = await ensureSource(userId, {
      path: URL_SOURCE_PATH,
      name: URL_SOURCE_NAME,
      sourceType: URL_SOURCE_TYPE,
    })
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: extracted.normalizedUrl,
      title: extracted.title,
      mimeType: "text/html",
      text: extracted.text,
    })
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId, title: extracted.title }
  } catch (err) {
    console.error("[indexUrl] failed:", err instanceof Error ? (err.stack ?? err.message) : err)
    return { error: "failed to index" }
  }
}
