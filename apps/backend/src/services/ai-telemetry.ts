import { db, aiUsageEvents } from "@yomi/db"

// Content-shaped keys that must never reach telemetry storage (spec 22
// non-goal: no raw prompt content beyond existing message/session tables).
const BLOCKED_METADATA_KEYS = new Set([
  "prompt",
  "messages",
  "content",
  "text",
  "transcript",
  "screenshot",
  "screenshots",
  "image",
  "images",
  "audio",
  "payload",
  "body",
])

export type AiUsageRecord = {
  userId: string
  requestId: string
  endpoint: string
  surface: string
  status: "done" | "error" | "cancelled"
  usageEventId?: string | null
  route?: string | null
  intent?: string | null
  complexity?: string | null
  model?: string | null
  provider?: string | null
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  embeddingTokens?: number
  maxOutputTokens?: number
  toolCalls?: number
  connectorIds?: string[]
  visionImages?: number
  voiceDurationSeconds?: number
  ttsChars?: number
  sttAudioSeconds?: number
  latencyMs?: number
  firstTokenLatencyMs?: number | null
  totalApiCostMicros?: number
  creditsEstimated?: number
  creditsCharged?: number
  errorCode?: string | null
  metadata?: Record<string, unknown>
}

export function sanitizeTelemetryMetadata(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!meta) return null
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (BLOCKED_METADATA_KEYS.has(key.toLowerCase())) continue
    out[key] = value
  }
  return Object.keys(out).length ? out : null
}

function clamp(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

// One-shot insert of a completed telemetry event. Idempotent on requestId
// (unique index + onConflictDoNothing). Best-effort: telemetry must never
// break a request path.
export async function recordAiUsage(input: AiUsageRecord): Promise<void> {
  try {
    await db
      .insert(aiUsageEvents)
      .values({
        userId: input.userId,
        requestId: input.requestId,
        usageEventId: input.usageEventId ?? null,
        endpoint: input.endpoint,
        surface: input.surface,
        route: input.route ?? null,
        intent: input.intent ?? null,
        complexity: input.complexity ?? null,
        model: input.model ?? null,
        provider: input.provider ?? "openai",
        inputTokens: clamp(input.inputTokens),
        outputTokens: clamp(input.outputTokens),
        reasoningTokens: clamp(input.reasoningTokens),
        cachedInputTokens: clamp(input.cachedInputTokens),
        embeddingTokens: clamp(input.embeddingTokens),
        maxOutputTokens: clamp(input.maxOutputTokens),
        toolCalls: clamp(input.toolCalls),
        connectorCount: input.connectorIds?.length ?? 0,
        connectorIds: input.connectorIds ?? [],
        visionImages: clamp(input.visionImages),
        voiceDurationSeconds: clamp(input.voiceDurationSeconds),
        ttsChars: clamp(input.ttsChars),
        sttAudioSeconds: clamp(input.sttAudioSeconds),
        latencyMs: clamp(input.latencyMs),
        firstTokenLatencyMs:
          typeof input.firstTokenLatencyMs === "number"
            ? Math.max(0, Math.floor(input.firstTokenLatencyMs))
            : null,
        totalApiCostMicros: clamp(input.totalApiCostMicros),
        creditsEstimated: clamp(input.creditsEstimated),
        creditsCharged: clamp(input.creditsCharged),
        status: input.status,
        errorCode: input.errorCode ?? null,
        metadata: sanitizeTelemetryMetadata(input.metadata),
        completedAt: new Date(),
      })
      .onConflictDoNothing({ target: aiUsageEvents.requestId })
  } catch (err) {
    console.warn(
      "[ai-telemetry] recordAiUsage failed:",
      err instanceof Error ? err.message : String(err),
    )
  }
}
