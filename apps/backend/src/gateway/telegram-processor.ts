import { getDefaultGateway } from "./gateway-runner.js"
import { TelegramAdapter, type TelegramUpdate } from "./platforms/telegram.js"

// Telegram redelivers an update (e.g. after a slow/lost 2xx during a deploy
// restart, or its own retry) if it doesn't get acked fast enough — without this
// a redelivered update runs the agent turn twice, and the second run (with
// nothing left to approve/act on) produces a confusing stray reply. update_id
// is per-bot monotonically increasing, so a bounded, time-evicted set is
// enough; no DB needed since this runs as a single process. The map lives in
// the webhook isolate AND the queue-consumer isolate; both check it.
const SEEN_UPDATE_ID_TTL_MS = 10 * 60 * 1000
const seenUpdateIds = new Map<number, number>()

export function isDuplicateTelegramUpdate(updateId: number): boolean {
  const now = Date.now()
  for (const [id, seenAt] of seenUpdateIds) {
    if (now - seenAt > SEEN_UPDATE_ID_TTL_MS) seenUpdateIds.delete(id)
  }
  if (seenUpdateIds.has(updateId)) return true
  seenUpdateIds.set(updateId, now)
  return false
}

// Process a Telegram update end-to-end: mark it seen, boot the gateway if this
// isolate has no adapter yet (minimal connect — the webhook-driven paths never
// run the one-time setChatMenuButton/deleteMyCommands setup), then hand the
// update to the adapter. Used by both the webhook's background fallback and the
// queue consumer so delivery semantics stay identical. Pass alreadyDeduped when
// the caller (the webhook route) already checked isDuplicateTelegramUpdate —
// otherwise a fresh check would skip the very update the caller is processing.
export async function processTelegramUpdate(
  update: TelegramUpdate,
  { alreadyDeduped = false }: { alreadyDeduped?: boolean } = {},
): Promise<void> {
  if (!alreadyDeduped && isDuplicateTelegramUpdate(update.update_id)) {
    console.warn(`[gateway/telegram] duplicate update=${update.update_id}, skipping`)
    return
  }

  const gateway = getDefaultGateway()
  if (!(gateway.getAdapter("telegram") instanceof TelegramAdapter)) {
    console.warn("[gateway/telegram] no adapter, attempting lazy gateway start")
    await gateway.start(undefined, { minimal: true })
  }
  const adapter = gateway.getAdapter("telegram")
  if (!(adapter instanceof TelegramAdapter)) {
    console.warn("[gateway/telegram] adapter unavailable, dropping update")
    return
  }

  await adapter.processUpdate(update)
}