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

function extensionFor(contentType: string): string {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
  }
  return known[contentType] ?? "bin"
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

  const key = `assets/${userId}/${crypto.randomUUID()}.${extensionFor(contentType)}`

  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: new Uint8Array(bytes),
      ContentType: contentType,
    }),
  )

  const url = await getSignedUrl(
    cfg.client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn: 3600 },
  )

  return { key, url, contentType }
}
