import { and, eq, ne } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"
import { indexDocument } from "./index-document.js"
import { checkConsent } from "../privacy/checks.js"

export const MANUAL_SOURCE_TYPE = "manual"
const MANUAL_SOURCE_NAME = "Chat notes"
const MANUAL_SOURCE_PATH = "chat-notes"

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
    .where(
      and(
        eq(ragSources.userId, userId),
        eq(ragSources.path, MANUAL_SOURCE_PATH),
        ne(ragSources.status, "deleted"),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(ragSources)
    .values({
      userId,
      name: MANUAL_SOURCE_NAME,
      path: MANUAL_SOURCE_PATH,
      sourceType: MANUAL_SOURCE_TYPE,
      status: "ready",
    })
    .onConflictDoNothing({ target: [ragSources.userId, ragSources.path] })
    .returning()
  if (created) return created.id

  // Lost the insert race (or hit a stale deleted row's unique slot) — re-select.
  // Note: if the only row at this path is soft-deleted, this still returns it —
  // acceptable rare edge case, not solved here.
  const [row] = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(and(eq(ragSources.userId, userId), eq(ragSources.path, MANUAL_SOURCE_PATH)))
    .limit(1)
  if (!row) throw new Error("failed to create or find manual source")
  return row.id
}

// Consent-gated wrapper around indexDocument() for agent-triggered text pastes. Never
// throws — a thrown error from checkConsent, ensureManualSource, or indexDocument would
// otherwise propagate out of the index_text tool's execute and kill the whole parent
// turn (same class of bug fixed for delegate/deep_research after item 6/5's final
// reviews), so the whole body — including the consent check — is guarded.
export async function indexManualText(
  userId: string,
  title: string,
  content: string,
): Promise<{ ok: true; documentId: string } | { error: string }> {
  try {
    const consent = await checkConsent(userId, "cloud_memory")
    if (!consent.allowed) {
      return {
        error: `cloud memory consent not granted${consent.reason ? `: ${consent.reason}` : ""}`,
      }
    }

    const sourceId = await ensureManualSource(userId)
    const result = await indexDocument({
      userId,
      sourceId,
      externalId: crypto.randomUUID(),
      title: cleanTitle(title, 200),
      mimeType: "text/plain",
      text: content,
    })
    // Only errors on a missing documentId — with a fresh externalId per call, indexDocument's
    // "unchanged" status is unreachable here, so checking for it (as an earlier draft of the
    // design spec suggested) would be dead code.
    if (!result.documentId) return { error: "failed to index" }
    return { ok: true, documentId: result.documentId }
  } catch (err) {
    console.error(
      "[indexManualText] failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return { error: "failed to index" }
  }
}
