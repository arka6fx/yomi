import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ConversationState } from "./conversation-state.js"
import type { PendingAction, TrackedEntity, ConversationTurn } from "./types.js"

const DATE_KEYS = new Set(["createdAt", "expiresAt", "timestamp"])

interface Snapshot {
  pendingActions: PendingAction[]
  entities: TrackedEntity[]
  turns: ConversationTurn[]
}

export function serializeState(state: ConversationState): string {
  const snap: Snapshot = {
    pendingActions: state.pendingActions.snapshot(),
    entities: state.entityStore.snapshot(),
    turns: state.turns.slice(-10),
  }
  return JSON.stringify(snap)
}

export function hydrateState(state: ConversationState, json: string): void {
  const snap = JSON.parse(json, (key, value) =>
    DATE_KEYS.has(key) && typeof value === "string" ? new Date(value) : value,
  ) as Snapshot
  state.pendingActions.restore(snap.pendingActions ?? [])
  state.entityStore.restore(snap.entities ?? [])
  state.turns = snap.turns ?? []
}

function stateDir(): string {
  if (process.env.YOMI_STATE_DIR) return process.env.YOMI_STATE_DIR // test-only override, keeps tests off the real dir
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
  return join(home, ".yomi", "state")
}

function stateFile(key: string): string {
  // Keys like "telegram:12345" must be filename-safe.
  return join(stateDir(), `conversation-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
}

export function saveStateToDisk(key: string, state: ConversationState): void {
  try {
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(stateFile(key), serializeState(state), "utf-8")
  } catch {
    // best-effort
  }
}

export function loadStateFromDisk(key: string, state: ConversationState): void {
  try {
    hydrateState(state, readFileSync(stateFile(key), "utf-8"))
  } catch {
    // ignore — first run or corrupt file starts fresh
  }
}
