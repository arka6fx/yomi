import { and, eq, isNull, lt, or } from "drizzle-orm"
import { db, ragSources, ragDocuments } from "@yomi/db"
import { driveExtract } from "./drive-extract.js"
import { indexDocument, deleteDocumentByExternalId } from "./index-document.js"
import { realDriveClient, DriveApiError, type DriveClient, type DriveFile } from "./drive-client.js"

export const MAX_BACKFILL_FILES_PER_TICK = 20
export const DRIVE_SOURCE_TYPE = "google-drive"

export interface DriveSyncState {
  folderId: string
  drivePageToken?: string
  backfillCursor?: string | null
  lastSyncedAt?: string
  filesIndexed: number
  filesSkipped: number
}
export interface SourceRow {
  id: string
  userId: string
  path: string | null
  status: string
  syncState: DriveSyncState | null
}

async function setSource(id: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .update(ragSources)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ragSources.id, id))
}

async function extractAndIndex(
  client: DriveClient,
  userId: string,
  sourceId: string,
  file: DriveFile,
): Promise<boolean> {
  const result = await driveExtract(file, (kind, mimeType) =>
    client.fetchContent(userId, file.id, kind, mimeType),
  )
  if ("skipped" in result) return false
  await indexDocument({
    userId,
    sourceId,
    externalId: file.id,
    title: file.name,
    mimeType: file.mimeType,
    text: result.text,
    metadata: { driveFileId: file.id, mimeType: file.mimeType, webViewLink: file.webViewLink },
  })
  return true
}

export async function createDriveSource(
  userId: string,
  folderId: string,
  name: string,
  client: DriveClient = realDriveClient,
): Promise<{ id: string }> {
  const startToken = await client.getStartPageToken(userId)
  const syncState: DriveSyncState = {
    folderId,
    drivePageToken: startToken,
    backfillCursor: null,
    filesIndexed: 0,
    filesSkipped: 0,
  }
  const [row] = await db
    .insert(ragSources)
    .values({
      userId,
      name,
      path: folderId,
      sourceType: DRIVE_SOURCE_TYPE,
      privacyScope: "cloud_rag",
      status: "backfilling",
      syncState,
    })
    .returning()
  return { id: row?.id ?? "" }
}

export async function syncSource(
  source: SourceRow,
  client: DriveClient = realDriveClient,
): Promise<{ status: string; indexed: number; removed: number }> {
  const st: DriveSyncState = source.syncState ?? {
    folderId: source.path ?? "",
    filesIndexed: 0,
    filesSkipped: 0,
  }
  try {
    if (source.status === "backfilling") return await backfillStep(source, st, client)
    return await incrementalStep(source, st, client)
  } catch (err) {
    if (err instanceof DriveApiError && (err.status === 401 || err.status === 403)) {
      await setSource(source.id, { status: "needs_reconnect" })
      return { status: "needs_reconnect", indexed: 0, removed: 0 }
    }
    if (err instanceof DriveApiError && err.status === 410) {
      // Page token expired — restart from a fresh backfill.
      const startToken = await client.getStartPageToken(source.userId)
      await setSource(source.id, {
        status: "backfilling",
        syncState: { ...st, drivePageToken: startToken, backfillCursor: null },
      })
      return { status: "backfilling", indexed: 0, removed: 0 }
    }
    throw err
  }
}

async function backfillStep(
  source: SourceRow,
  st: DriveSyncState,
  client: DriveClient,
): Promise<{ status: string; indexed: number; removed: number }> {
  const page = await client.listFolderChildren(
    source.userId,
    st.folderId,
    st.backfillCursor ?? undefined,
    MAX_BACKFILL_FILES_PER_TICK,
  )
  let indexed = 0
  for (const file of page.files) {
    const ok = await extractAndIndex(client, source.userId, source.id, file)
    if (ok) {
      indexed++
      st.filesIndexed++
    } else {
      st.filesSkipped++
    }
  }
  const done = !page.nextPageToken
  st.backfillCursor = page.nextPageToken ?? null
  st.lastSyncedAt = new Date().toISOString()
  await setSource(source.id, {
    status: done ? "active" : "backfilling",
    syncState: st,
  })
  return { status: done ? "active" : "backfilling", indexed, removed: 0 }
}

async function incrementalStep(
  source: SourceRow,
  st: DriveSyncState,
  client: DriveClient,
): Promise<{ status: string; indexed: number; removed: number }> {
  const knownIds = await loadKnownExternalIds(source.id)
  let token = st.drivePageToken ?? (await client.getStartPageToken(source.userId))
  let indexed = 0
  let removed = 0
  for (;;) {
    const res = await client.listChanges(source.userId, token)
    for (const change of res.changes) {
      // Removals: the Drive changes feed typically omits `file` (and therefore
      // `parents`) once a file is gone, so we can't scope-check via parents here.
      // deleteDocumentByExternalId is itself scoped to (sourceId, externalId) and
      // is a safe no-op if the fileId was never indexed under this source, so
      // removals are always attempted rather than gated on the in-scope check below.
      if (change.removed || change.file?.trashed) {
        if (await deleteDocumentByExternalId(source.userId, source.id, change.fileId)) removed++
        knownIds.delete(change.fileId)
        continue
      }
      const inScope =
        knownIds.has(change.fileId) ||
        (change.file?.parents?.includes(st.folderId) ?? false)
      if (!inScope) continue
      if (change.file) {
        const ok = await extractAndIndex(client, source.userId, source.id, change.file)
        if (ok) {
          indexed++
          knownIds.add(change.fileId)
        }
      }
    }
    if (res.nextPageToken) {
      token = res.nextPageToken
      continue
    }
    token = res.newStartPageToken ?? token
    break
  }
  st.drivePageToken = token
  st.lastSyncedAt = new Date().toISOString()
  await setSource(source.id, { status: "active", syncState: st })
  return { status: "active", indexed, removed }
}

async function loadKnownExternalIds(sourceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: ragDocuments.externalId })
    .from(ragDocuments)
    .where(eq(ragDocuments.sourceId, sourceId))
  return new Set(rows.map((r) => r.externalId).filter((x): x is string => !!x))
}

export const MAX_SOURCES_PER_SWEEP = 10

// Sweeps due google-drive sources on the cron tick. `backfilling` sources are
// always due (so an initial backfill completes promptly at one batch per
// tick); `active` sources are due only once `updatedAt` is stale past
// DRIVE_SYNC_INTERVAL_MS. Per-source failures are caught so one bad source
// never blocks the rest of the sweep or the worker's scheduled() handler.
export async function runDriveSyncSweep(
  run: (s: SourceRow, c?: DriveClient) => Promise<unknown> = syncSource,
): Promise<{ ran: number }> {
  const intervalMs = Number(process.env["DRIVE_SYNC_INTERVAL_MS"] ?? 6 * 60 * 60 * 1000)
  const cutoff = new Date(Date.now() - intervalMs)
  const rows = await db
    .select()
    .from(ragSources)
    .where(
      and(
        eq(ragSources.sourceType, DRIVE_SOURCE_TYPE),
        or(
          eq(ragSources.status, "backfilling"),
          and(
            eq(ragSources.status, "active"),
            or(isNull(ragSources.updatedAt), lt(ragSources.updatedAt, cutoff)),
          ),
        ),
      ),
    )
    .limit(MAX_SOURCES_PER_SWEEP)
  let ran = 0
  for (const row of rows) {
    try {
      await run(row as unknown as SourceRow)
      ran++
    } catch (err) {
      console.error(`[drive-sync] source ${(row as { id: string }).id} failed:`, err)
    }
  }
  return { ran }
}
