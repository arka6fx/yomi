import {
  captureCloudMemory,
  retrieveCloudMemoryProfile,
  retrieveCloudMemoryContext,
  retrieveCloudRagContext,
} from "./cloud-rag.js"

export type SessionTurn = {
  kind: "fast" | "agent"
  input: string
  output: string
  mode?: string
  summary?: string
}

export type MemoryContextBundle = {
  memorySummary: string
  memoryIndex: string
  durableMemory: string
  localMemory: string
  cloudRagContext: string
  staticProfile: string
  dynamicProfile: string
  recentSession: string
}

export async function initMemorySubsystem(): Promise<void> {
  return
}

export function closeMemorySubsystem(): void {
  return
}

export async function loadMemoryContext(query: string): Promise<MemoryContextBundle> {
  const [durableMemory, cloudRagContext, profile] = await Promise.all([
    retrieveCloudMemoryContext(query, 3500),
    retrieveCloudRagContext(query, 3000),
    retrieveCloudMemoryProfile(query, 2500),
  ])

  return {
    memorySummary: "",
    memoryIndex: "",
    durableMemory,
    localMemory: "",
    cloudRagContext,
    staticProfile: profile.staticProfile,
    dynamicProfile: profile.dynamicProfile,
    recentSession: "",
  }
}

export async function retrieveMemoryContext(query: string, maxChars = 3000): Promise<string> {
  return await retrieveCloudMemoryContext(query, maxChars)
}

export async function retrieveArchiveContext(query: string, maxChars = 3000): Promise<string> {
  return await retrieveCloudRagContext(query, maxChars)
}

export function writeSessionTurn(_turn: SessionTurn): void {
  return
}

export async function flushSessionWriteQueue(): Promise<void> {
  return
}

export async function captureStructuredMemory(turn: {
  input: string
  output: string
  mode?: string
  sourcePath?: string
}): Promise<void> {
  await captureCloudMemory(turn)
}

export async function initLocalRag(): Promise<void> {
  return
}

export async function reindexEmbeddings(): Promise<number> {
  return 0
}
