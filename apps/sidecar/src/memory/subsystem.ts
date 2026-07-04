import {
  captureCloudMemory,
  retrieveCloudMemoryProfile,
  retrieveCloudMemoryContext,
  retrieveCloudRagContext,
} from "./cloud-rag.js"
import { appendTurn, loadRecentTurns } from "./chat-history.js"
import { runFullConsolidation, getConsolidationStatus } from "./consolidation.js"
import { runPromotionCycle, ensureMemoryFile, getPromotedContent } from "./promotion.js"
import { recordRecall, getRecallStats, pruneStaleRecalls, resetRecallCache } from "./recall-store.js"
import { clearMemoryCache } from "./middleware.js"

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

let _turnId = 0
let _consolidationInterval: ReturnType<typeof setInterval> | null = null

const CONSOLIDATION_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

export async function initMemorySubsystem(): Promise<void> {
  await ensureMemoryFile()
  await pruneStaleRecalls().catch(() => {})
  resetRecallCache()
  clearMemoryCache()

  if (!_consolidationInterval) {
    _consolidationInterval = setInterval(async () => {
      const status = await getConsolidationStatus()
      if (!status.isRunning) {
        console.warn("[yomi/memory] running periodic consolidation")
        await runFullConsolidation().catch((err) =>
          console.warn("[yomi/memory] consolidation failed:", err instanceof Error ? err.message : err)
        )
      }
    }, CONSOLIDATION_INTERVAL_MS)
  }
}

export function closeMemorySubsystem(): void {
  if (_consolidationInterval) {
    clearInterval(_consolidationInterval)
    _consolidationInterval = null
  }
}

export async function loadMemoryContext(query: string): Promise<MemoryContextBundle> {
  const [durableMemory, cloudRagContext, profile, promotedContent] = await Promise.all([
    retrieveCloudMemoryContext(query, 3500),
    retrieveCloudRagContext(query, 3000),
    retrieveCloudMemoryProfile(query, 2500),
    getPromotedContent(3000).catch(() => ""),
  ])

  let recentSession = ""
  try {
    const recent = await loadRecentTurns(10)
    if (recent.length) {
      recentSession = recent
        .map(
          (t) =>
            `[${new Date(t.timestamp).toLocaleTimeString()}] you: ${t.text}`,
        )
        .join("\n")
    }
  } catch {
    // best-effort: local session history unavailable
  }

  // Build memory summary from promoted content + durable memory
  const memorySummary = buildMemorySummary(durableMemory, promotedContent)
  const memoryIndex = buildMemoryIndex(durableMemory)

  return {
    memorySummary,
    memoryIndex,
    durableMemory,
    localMemory: promotedContent,
    cloudRagContext,
    staticProfile: profile.staticProfile,
    dynamicProfile: profile.dynamicProfile,
    recentSession,
  }
}

function buildMemorySummary(durableMemory: string, promotedContent: string): string {
  const staticLines: string[] = []
  const dynamicLines: string[] = []

  for (const line of durableMemory.split("\n")) {
    if (line.startsWith("- [preference]") || line.startsWith("- [fact]")) {
      staticLines.push(line.replace(/^- \[[^\]]+\]/, "").trim())
    } else if (line.startsWith("- [")) {
      dynamicLines.push(line.replace(/^- \[[^\]]+\]/, "").trim())
    }
  }

  const promotedLines = promotedContent
    .split("\n")
    .filter((l) => l.startsWith("**Topic:"))
    .map((l) => l.replace("**Topic:**", "").trim())
    .slice(0, 5)

  const parts: string[] = []
  if (staticLines.length) parts.push("Stable: " + staticLines.join(", "))
  if (dynamicLines.length) parts.push("Recent: " + dynamicLines.slice(0, 3).join(", "))
  if (promotedLines.length) parts.push("Promoted: " + promotedLines.join(", "))

  const summary = parts.join(". ").slice(0, 800)
  return summary
}

function buildMemoryIndex(durableMemory: string): string {
  return durableMemory
    .split("\n")
    .filter((l) => l.startsWith("- [") && l.includes("confidence"))
    .slice(0, 15)
    .join("\n")
}

export async function retrieveMemoryContext(query: string, maxChars = 3000): Promise<string> {
  const result = await retrieveCloudMemoryContext(query, maxChars)
  return result
}

export async function retrieveArchiveContext(query: string, maxChars = 3000): Promise<string> {
  return await retrieveCloudRagContext(query, maxChars)
}

export async function writeSessionTurn(turn: SessionTurn): Promise<void> {
  try {
    _turnId++
    await appendTurn({
      id: _turnId,
      transcript: turn.input,
      text: turn.output,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.warn("[yomi/subsystem] failed to write session turn:", err instanceof Error ? err.message : err)
  }
}

export async function flushSessionWriteQueue(): Promise<void> {
  try {
    // Run a lightweight promotion pass and prune stale entries on session end
    const [promoResult, stats] = await Promise.all([
      runPromotionCycle({ minScore: 0.8, minRecalls: 2 }).catch(() => null),
      getRecallStats().catch(() => ({ total: 0, promoted: 0, stalePruned: 0 })),
    ])
    if (promoResult && promoResult.promoted > 0) {
      console.warn(`[yomi/memory] promoted ${promoResult.promoted} memories on session end`)
    }
    if (stats.total > 0) {
      console.warn(`[yomi/memory] recall store: ${stats.total} entries, ${stats.promoted} promoted`)
    }
    clearMemoryCache()
  } catch {
    // best-effort
  }
}

export async function captureStructuredMemory(turn: {
  input: string
  output: string
  mode?: string
  sourcePath?: string
}): Promise<void> {
  await captureCloudMemory(turn)
}

export async function onAgentTurnComplete(turn: {
  input: string
  output: string
  summary?: string
}): Promise<void> {
  // Record recall for extracted memories — this feeds the promotion pipeline
  try {
    await recordRecall("session", turn.summary ?? turn.output.slice(0, 100), turn.output.slice(0, 500), turn.input, 0.5)
  } catch {
    // best-effort
  }
  
  // Extract and store structured memories automatically (best-effort)
  try {
    await captureCloudMemory({ 
      input: turn.input, 
      output: turn.output, 
      sourcePath: undefined 
    })
  } catch {
    // best-effort memory extraction - don't let failures affect main flow
  }
}

export async function initLocalRag(): Promise<void> {
  return
}

export async function reindexEmbeddings(): Promise<number> {
  return 0
}

export async function triggerConsolidation(): Promise<void> {
  const status = await getConsolidationStatus()
  if (!status.isRunning) {
    await runFullConsolidation()
  }
}
