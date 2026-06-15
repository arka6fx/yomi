import { initMemoryDir, loadMemoryIndex, loadMemorySummary } from "./loader.js"
import {
  closeMemoryEngine,
  initMemoryEngine,
  readProfile,
  retrieveLocalMemoryContext,
  captureTurnMemory,
} from "./engine.js"
import { closeLocalRag, initLocalRag } from "./local-rag.js"
import { appendSessionTurn, loadRecentSession, type SessionTurn } from "./session.js"
import { retrieveCloudRagContext, scheduleCloudRagSync } from "./cloud-rag.js"

const MAX_MEMORY_SUMMARY_CHARS = 4000
const MAX_MEMORY_INDEX_CHARS = 2000

export type MemoryContextBundle = {
  memorySummary: string
  memoryIndex: string
  localMemory: string
  cloudRagContext: string
  staticProfile: string
  dynamicProfile: string
  recentSession: string
}

export async function initMemorySubsystem(): Promise<void> {
  await initMemoryDir()
  await Promise.all([initMemoryEngine(), initLocalRag()])
  scheduleCloudRagSync("startup")
}

export function closeMemorySubsystem(): void {
  closeMemoryEngine()
  closeLocalRag()
}

export async function loadMemoryContext(query: string): Promise<MemoryContextBundle> {
  const [
    memorySummary,
    memoryIndex,
    localMemory,
    cloudRagContext,
    staticProfile,
    dynamicProfile,
    recentSession,
  ] = await Promise.all([
    loadMemorySummary(),
    loadMemoryIndex(),
    Promise.resolve(retrieveLocalMemoryContext(query, 3000)),
    retrieveCloudRagContext(query, 3000),
    readProfile("static"),
    readProfile("dynamic"),
    loadRecentSession(),
  ])

  return {
    memorySummary: memorySummary.slice(0, MAX_MEMORY_SUMMARY_CHARS),
    memoryIndex: memoryIndex.slice(0, MAX_MEMORY_INDEX_CHARS),
    localMemory,
    cloudRagContext,
    staticProfile,
    dynamicProfile,
    recentSession,
  }
}

export function retrieveMemoryContext(query: string, maxChars = 3000): string {
  return retrieveLocalMemoryContext(query, maxChars)
}

export async function retrieveArchiveContext(query: string, maxChars = 3000): Promise<string> {
  return await retrieveCloudRagContext(query, maxChars)
}

// Async FIFO write queue — serialises session writes so back-to-back turns
// never land out of order, and never block the response pipeline on slow I/O.
let _writeQueue: Promise<void> = Promise.resolve()

export function writeSessionTurn(turn: SessionTurn): void {
  _writeQueue = _writeQueue
    .then(() => appendSessionTurn(turn))
    .catch(() => {
      // ignore — best-effort session logging
    })
}

export async function flushSessionWriteQueue(): Promise<void> {
  await _writeQueue
}

export async function captureStructuredMemory(turn: {
  input: string
  output: string
  mode?: string
  sourcePath?: string
}): Promise<void> {
  await captureTurnMemory(turn)
}

export { initLocalRag }
