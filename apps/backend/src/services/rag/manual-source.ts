import { and, eq } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"

export const MANUAL_SOURCE_TYPE = "manual"
const MANUAL_SOURCE_NAME = "Chat notes"

function cleanTitle(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

// Idempotent get-or-create: every index_text call for a user reuses the same
// "Chat notes" source rather than creating a new one each time.
export async function ensureManualSource(userId: string): Promise<string> {
  const existing = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(and(eq(ragSources.userId, userId), eq(ragSources.sourceType, MANUAL_SOURCE_TYPE)))
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(ragSources)
    .values({
      userId,
      name: MANUAL_SOURCE_NAME,
      sourceType: MANUAL_SOURCE_TYPE,
      status: "ready",
    })
    .returning()
  return created!.id
}

// Consent-gated wrapper around indexDocument() for agent-triggered text pastes. Never
// throws — a thrown error from indexDocument would otherwise propagate out of the
// index_text tool's execute and kill the whole parent turn (same class of bug fixed
// for delegate/deep_research after item 6/5's final reviews).
export async function indexManualText(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  const consent = await checkConsent(userId, "cloud_memory")
  if (!consent.allowed) return { error: "cloud memory consent not granted" }

  try {
    const sourceId = await ensureManualSource(userId)
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: crypto.randomUUID(),
      title: cleanTitle(title, 200),
      mimeType: "text/plain",
      text: content,
    })
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId }
  } catch {
    return { error: "failed to index" }
  }
}
