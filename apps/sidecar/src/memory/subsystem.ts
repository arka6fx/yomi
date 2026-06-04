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

export async function writeSessionTurn(turn: SessionTurn): Promise<void> {
  await appendSessionTurn(turn)
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
