import type { Plan } from "@yomi/shared"
import { buildAgentPrompt, loadYomiMd } from "../harness/prompt.js"
import { loadMemoryContext } from "../memory/subsystem.js"
import { memoryEnabled } from "./deps.js"

function getDesktopFocusContext(): string { return "" }

const EMPTY_MEMORY = {
  memorySummary: "",
  memoryIndex: "",
  localMemory: "",
  cloudRagContext: "",
  staticProfile: "",
  dynamicProfile: "",
  recentSession: "",
}

// yomi.md is stable per-session; cache it. Memory files change after compaction so load fresh.
let cachedYomiMd: string | null = null

export interface BuiltPrompt {
  systemPrompt: string
  // which memory sections carried content this turn (for state.memoryRefs — minimal, not the text)
  memoryRefs: string[]
}

// Same prompt assembly the legacy agent used (getAgentPrompt), surfaced for the Memory node.
export async function buildGraphSystemPrompt(
  goal: string,
  plan: Plan | undefined,
): Promise<BuiltPrompt> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  const memoryCtx = memoryEnabled(plan) ? await loadMemoryContext(goal) : EMPTY_MEMORY
  const memoryRefs = Object.entries(memoryCtx)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key]) => key)
  return {
    systemPrompt: buildAgentPrompt({ yomiMd: cachedYomiMd, ...memoryCtx, desktopFocusChange: getDesktopFocusContext() }),
    memoryRefs,
  }
}

export function __resetPromptCacheForTest(): void {
  cachedYomiMd = null
}
