// Re-hosts a Telegram attachment (photo, video, document) somewhere a connector's
// API can actually fetch it from. Telegram's own file URLs require the bot token,
// so third-party APIs (Instagram, YouTube, ...) can't reach them directly — this
// gives the agent a plain HTTPS URL instead. Assets are transient for a single
// agent turn; avatars persist and are served through a stable proxy route.
//
// Storage is a Cloudflare R2 binding (YOMI_ASSETS), wired in worker.ts. Until the
// bucket is created and bound, `setAssetBucket` is never called and every entry
// point returns null / false so callers degrade gracefully — same pattern as
// extractTextViaDrive()'s null-on-unavailable.
//
// R2 objects are privately writable and served only through the Worker's
// GET /api/assets/:encodedKey (and /api/user/avatar/:userId) proxy routes. There
// is no presigned-URL path anymore: `url` and `publicUrl` are the same stable
// proxy URL, which is fine for connector APIs and for avatar rows referenced by
// many viewers.

export interface UploadedAsset {
  key: string
  url: string
  publicUrl: string
  contentType: string
}

// Structural subset of the Workers R2Bucket binding we actually use, declared
// locally so @yomi/backend doesn't need @cloudflare/workers-types to compile.
export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
}

let bucket: R2BucketLike | null = null

export function setAssetBucket(next: R2BucketLike | null): void {
  bucket = next
}

// True when asset storage is bound — lets callers skip the upload attempt
// entirely (and give the user a clear "not set up yet" message) instead of
// discovering it mid-request.
export function assetStorageConfigured(): boolean {
  return bucket !== null
}

function publicAssetBaseUrl(): string {
  return (
    process.env["BETTER_AUTH_BASE_URL"] ??
    process.env["BACKEND_URL"] ??
    process.env["YOMI_APP_URL"] ??
    "https://api.getyomi.in"
  ).replace(/\/$/, "")
}

export function encodeAssetKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url")
}

export function decodeAssetKey(encodedKey: string): string {
  return Buffer.from(encodedKey, "base64url").toString("utf8")
}

const KNOWN_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
}

const MAGIC_BYTE_SNIFFERS: Array<{
  contentType: string
  extension: string
  matches: (b: Uint8Array) => boolean
}> = [
  {
    contentType: "image/jpeg",
    extension: "jpg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    contentType: "image/png",
    extension: "png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    contentType: "image/gif",
    extension: "gif",
    matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45,
  },
]

// Callers (e.g. Telegram's file-download CDN) sometimes report a generic
// content-type like application/octet-stream instead of the file's real type.
// Trusting that blindly produces a .bin asset with a wrong Content-Type header
// that connectors' APIs (e.g. Instagram) then reject as "not a photo or video" —
// so an unrecognized content-type falls back to sniffing the actual bytes.
export function resolveAssetType(
  contentType: string,
  bytes: Uint8Array,
): { extension: string; contentType: string } {
  const known = KNOWN_EXTENSIONS[contentType]
  if (known) return { extension: known, contentType }
  const sniffed = MAGIC_BYTE_SNIFFERS.find((s) => s.matches(bytes))
  if (sniffed) return { extension: sniffed.extension, contentType: sniffed.contentType }
  return { extension: "bin", contentType }
}

// Uploads bytes under the user's namespace and returns the stable proxy URL the
// agent can hand to a connector API.
export async function uploadAsset(
  userId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<UploadedAsset | null> {
  if (!bucket) return null

  const body = new Uint8Array(bytes)
  const resolved = resolveAssetType(contentType, body)
  const key = `assets/${userId}/${crypto.randomUUID()}.${resolved.extension}`

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: resolved.contentType },
  })

  const publicUrl = `${publicAssetBaseUrl()}/api/assets/${encodeAssetKey(key)}`
  return { key, url: publicUrl, publicUrl, contentType: resolved.contentType }
}

// Uploads an avatar under a dedicated `avatars/` prefix, distinct from the
// `assets/` prefix used for transient Telegram attachments. Avatars are served
// through the stable GET /api/user/avatar/:userId proxy route, since a short-lived
// URL's expiry doesn't work for an image referenced from many viewers'
// leaderboard rows over time.
export async function uploadAvatar(
  userId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ key: string; contentType: string } | null> {
  if (!bucket) return null

  const body = new Uint8Array(bytes)
  const resolved = resolveAssetType(contentType, body)
  const key = `avatars/${userId}/${crypto.randomUUID()}.${resolved.extension}`

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: resolved.contentType },
  })

  return { key, contentType: resolved.contentType }
}

export async function fetchAsset(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!bucket) return null
  const object = await bucket.get(key)
  if (!object) return null
  return {
    bytes: new Uint8Array(await object.arrayBuffer()),
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
  }
}
