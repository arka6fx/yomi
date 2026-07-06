import { and, eq, isNull, lt, or } from "drizzle-orm"
import { db, ragSources, ragDocuments } from "@yomi/db"
import { driveExtract } from "./drive-extract.js"
import { indexDocument, deleteDocumentByExternalId } from "./index-document.js"
import { realDriveClient, DriveApiError, type DriveClient, type DriveFile } from "./drive-client.js"

export const MAX_BACKFILL_FILES_PER_TICK = 20
export const DRIVE_SOURCE_TYPE = "google-drive"
const DEFAULT_MAX_FILES_PER_SOURCE = 2000

// Cost guardrail: cap total indexed files per Drive source. Read lazily (not
// memoized at module scope) so a Worker's propagateEnv is visible per-call.
function maxFilesPerSource(): number {
  const raw = process.env["DRIVE_MAX_FILES_PER_SOURCE"]
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FILES_PER_SOURCE
}

export interface DriveSyncState {
  folderId: string
  drivePageToken?: string
  backfillCursor?: string | null
  lastSyncedAt?: string
  filesIndexed: number
  filesSkipped: number
  capped?: boolean
  // Sweep lease: set when a tick claims this source, cleared by the sync's
  // completion write. An overlapping cron tick skips sources leased recently.
  syncingAt?: string
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
        syncState: {
          ...st,
          drivePageToken: startToken,
          backfillCursor: null,
          filesIndexed: 0,
          filesSkipped: 0,
        },
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
  const cap = maxFilesPerSource()
  const page = await client.listFolderChildren(
    source.userId,
    st.folderId,
    st.backfillCursor ?? undefined,
    MAX_BACKFILL_FILES_PER_TICK,
  )
  let indexed = 0
  for (const file of page.files) {
    try {
      const ok = await extractAndIndex(client, source.userId, source.id, file)
      if (ok) {
        indexed++
        st.filesIndexed++
      } else {
        st.filesSkipped++
      }
    } catch (err) {
      if (err instanceof DriveApiError && (err.status === 401 || err.status === 403)) throw err
      console.error(`[drive-sync] file ${file.id} failed:`, err)
      st.filesSkipped++
    }
    if (st.filesIndexed >= cap) break
  }
  st.lastSyncedAt = new Date().toISOString()
  if (st.filesIndexed >= cap) {
    st.backfillCursor = null
    st.capped = true
    await setSource(source.id, { status: "active", syncState: st })
    return { status: "active", indexed, removed: 0 }
  }
  const done = !page.nextPageToken
  st.backfillCursor = page.nextPageToken ?? null
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
  const cap = maxFilesPerSource()
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
        // Cost guardrail extends to incremental sync: past the per-source cap,
        // brand-new files are skipped; already-indexed files still re-index.
        const isNew = !knownIds.has(change.fileId)
        if (isNew && st.filesIndexed >= cap) {
          st.filesSkipped++
          st.capped = true
          continue
        }
        try {
          const ok = await extractAndIndex(client, source.userId, source.id, change.file)
          if (ok) {
            indexed++
            if (isNew) st.filesIndexed++
            knownIds.add(change.fileId)
          }
        } catch (err) {
          if (err instanceof DriveApiError && (err.status === 401 || err.status === 403)) throw err
          console.error(`[drive-sync] file ${change.fileId} failed:`, err)
          st.filesSkipped++
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
// How long a sweep's claim on a source excludes it from later ticks. Bounds
// double-processing when a tick runs long; a crashed tick self-heals after this.
const SYNC_LEASE_MS = 5 * 60 * 1000

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
  const now = Date.now()
  let ran = 0
  for (const row of rows) {
    const source = row as unknown as SourceRow
    // Skip sources another (still-running) tick has leased recently — a
    // backfill batch can outlive the 60s cron cadence.
    const leasedAt = source.syncState?.syncingAt ? Date.parse(source.syncState.syncingAt) : NaN
    if (Number.isFinite(leasedAt) && now - leasedAt < SYNC_LEASE_MS) continue
    try {
      // Claim the lease before running; syncSource's completion write rebuilds
      // syncState without syncingAt, which clears it.
      await setSource(source.id, {
        syncState: { ...(source.syncState ?? {}), syncingAt: new Date(now).toISOString() },
      })
      await run(source)
      ran++
    } catch (err) {
      console.error(`[drive-sync] source ${source.id} failed:`, err)
    }
  }
  return { ran }
}

// Purges a user's Drive-backed rag sources: soft-deletes the source rows and
// hard-deletes their documents (chunks/embeddings cascade via FK). Called when
// the user disconnects the google-drive integration so indexed content doesn't
// outlive the connection.
export async function purgeDriveSources(userId: string): Promise<number> {
  const rows = await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(ragSources.userId, userId), eq(ragSources.sourceType, DRIVE_SOURCE_TYPE)))
    .returning({ id: ragSources.id })
  for (const row of rows) {
    await db.delete(ragDocuments).where(eq(ragDocuments.sourceId, row.id))
  }
  return rows.length
}
