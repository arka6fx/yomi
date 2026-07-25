import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// Re-hosts a Telegram attachment (photo, video, document) somewhere a connector's
// API can actually fetch it from. Telegram's own file URLs require the bot token,
// so third-party APIs (Instagram, YouTube, ...) can't reach them directly — this
// gives the agent a plain HTTPS URL instead. Objects expire after 30 days (bucket
// lifecycle rule); these are transient assets for a single agent turn, not
// permanent storage. Returns null when S3 isn't configured so callers can degrade
// gracefully, same pattern as extractTextViaDrive()'s null-on-unavailable.

export interface UploadedAsset {
  key: string
  url: string
  contentType: string
}

function s3Config() {
  const bucket = process.env["YOMI_ASSETS_BUCKET"]
  const region = process.env["YOMI_ASSETS_AWS_REGION"]
  const accessKeyId = process.env["YOMI_ASSETS_AWS_ACCESS_KEY_ID"]
  const secretAccessKey = process.env["YOMI_ASSETS_AWS_SECRET_ACCESS_KEY"]
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null
  return { bucket, region, accessKeyId, secretAccessKey }
}

let cachedClient: { client: S3Client; bucket: string } | null | undefined

function client(): { client: S3Client; bucket: string } | null {
  if (cachedClient !== undefined) return cachedClient
  const config = s3Config()
  if (!config) {
    cachedClient = null
    return null
  }
  cachedClient = {
    bucket: config.bucket,
    client: new S3Client({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  }
  return cachedClient
}

// True when asset storage is configured — lets callers skip the upload attempt
// entirely (and give the user a clear "not set up yet" message) instead of
// discovering it mid-request.
export function assetStorageConfigured(): boolean {
  return client() !== null
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

const MAGIC_BYTE_SNIFFERS: Array<{ contentType: string; extension: string; matches: (b: Uint8Array) => boolean }> = [
  { contentType: "image/jpeg", extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    contentType: "image/png",
    extension: "png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { contentType: "image/gif", extension: "gif", matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  },
]

// Callers (e.g. Telegram's file-download CDN) sometimes report a generic
// content-type like application/octet-stream instead of the file's real type.
// Trusting that blindly produces a .bin asset with a wrong Content-Type header
// that connectors' APIs (e.g. Instagram) then reject as "not a photo or video" —
// so an unrecognized content-type falls back to sniffing the actual bytes.
export function resolveAssetType(contentType: string, bytes: Uint8Array): { extension: string; contentType: string } {
  const known = KNOWN_EXTENSIONS[contentType]
  if (known) return { extension: known, contentType }
  const sniffed = MAGIC_BYTE_SNIFFERS.find((s) => s.matches(bytes))
  if (sniffed) return { extension: sniffed.extension, contentType: sniffed.contentType }
  return { extension: "bin", contentType }
}

// Uploads bytes under the user's namespace and returns a short-lived presigned
// GET URL. The bucket is fully private (no public-read) — the presigned URL is
// the only way to fetch the object, and it's scoped to expire well before the
// bucket's own 30-day object lifecycle would.
export async function uploadAsset(
  userId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<UploadedAsset | null> {
  const cfg = client()
  if (!cfg) return null

  const body = new Uint8Array(bytes)
  const resolved = resolveAssetType(contentType, body)
  const key = `assets/${userId}/${crypto.randomUUID()}.${resolved.extension}`

  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: resolved.contentType,
    }),
  )

  const url = await getSignedUrl(
    cfg.client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn: 3600 },
  )

  return { key, url, contentType: resolved.contentType }
}
