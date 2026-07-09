// Memory consolidation and dreaming engine.
// Runs periodic consolidation cycles to surface patterns, merge duplicates,
// and promote critical memories. Inspired by OpenClaw's dreaming system.

import { readFile, writeFile, mkdir, appendFile, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { generateText } from "ai"
import { createModel } from "@yomi/agent-core"
import { notepadDir } from "./loader.js"
import { runPromotionCycle, readMemoryFile } from "./promotion.js"

type ConsolidationPhase = "light" | "rem" | "deep"

type ConsolidationResult = {
  phase: ConsolidationPhase
  entriesProcessed: number
  duplicatesMerged: number
  patternsFound: number
  diaryEntry?: string
}

const MEMORY_EXTRACTION_MODEL =
  process.env["MEMORY_EXTRACTION_MODEL"] || process.env["OPENAI_FAST_MODEL"] || "gpt-4.1-mini"

let _lastLightRun: string | null = null
let _lastRemRun: string | null = null
let _isRunning = false

function datePath(date: string): string {
  return join(notepadDir(), "memory", `${date}.md`)
}

function dreamsPath(): string {
  return join(notepadDir(), "DREAMS.md")
}

async function ensureDirs(): Promise<void> {
  await mkdir(join(notepadDir(), "memory"), { recursive: true })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function readDailyMemoryFiles(lookbackDays = 7): Promise<string[]> {
  await ensureDirs()
  const dir = join(notepadDir(), "memory")
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - lookbackDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const results: string[] = []
  for (const file of files.sort().reverse()) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue
    if (file.slice(0, 10) < cutoffStr) continue
    try {
      const content = await readFile(join(dir, file), "utf-8")
      results.push(`### ${file}\n${content}`)
    } catch {
      // skip
    }
  }
  return results
}

async function readSessionTranscripts(lookbackDays = 3): Promise<string[]> {
  const dir = join(notepadDir(), "sessions")
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - lookbackDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const results: string[] = []
  for (const file of files.sort().reverse()) {
    if (!file.startsWith("session-") || !file.endsWith(".md")) continue
    const datePart = file.replace("session-", "").replace(".md", "")
    if (datePart < cutoffStr) continue
    try {
      const content = await readFile(join(dir, file), "utf-8")
      if (content.trim()) results.push(content.trim())
    } catch {
      // skip
    }
  }
  return results
}

async function writeDiaryEntry(
  date: string,
  phase: ConsolidationPhase,
  content: string,
): Promise<void> {
  const path = datePath(date)
  await mkdir(dirname(path), { recursive: true })
  const header = `## ${phase === "light" ? "Light Sleep" : "REM Sleep"} — ${new Date().toISOString()}\n\n`
  await appendFile(path, header + content + "\n\n", "utf-8")
}

async function extractPatterns(entries: string[]): Promise<{
  patterns: string[]
  duplicates: Array<{ topic: string; count: number }>
}> {
  if (!entries.length) return { patterns: [], duplicates: [] }

  const { text } = await generateText({
    model: createModel(MEMORY_EXTRACTION_MODEL),
    messages: [
      {
        role: "user",
        content: `Analyze these memory entries for patterns and duplicates.

Return strict JSON only:
{"patterns":["pattern1","pattern2"],"duplicates":[{"topic":"topic","count":2}]}

Rules:
- Identify recurring themes, preferences, and behavioral patterns.
- Flag near-duplicate memories that could be merged.
- Only include high-confidence patterns.

Entries:
${entries.join("\n---\n")}`,
      },
    ],
  })

  try {
    return JSON.parse(text)
  } catch {
    return { patterns: [], duplicates: [] }
  }
}

async function generateDiaryNarrative(
  phase: ConsolidationPhase,
  memorySnippets: string[],
  patterns: string[],
): Promise<string> {
  if (!memorySnippets.length) return ""

  const { text } = await generateText({
    model: createModel(MEMORY_EXTRACTION_MODEL),
    messages: [
      {
        role: "user",
        content: `You are a gentle, observant mind reflecting on the day's interactions. Write a brief ${phase === "light" ? "light" : "deep"} reflection weaving together these memory fragments.

Rules:
- First person, flowing prose, 60-120 words.
- Mix the technical and the tender.
- Never say "I'm dreaming" or "in my dream."
- Never mention AI, agent, LLM, or model.
- No markdown formatting — just prose.

Memory fragments:
${memorySnippets.map((s, i) => `[${i + 1}] ${s}`).join("\n")}
${patterns.length ? `\nEmerging patterns:\n${patterns.map((p) => `- ${p}`).join("\n")}` : ""}`,
      },
    ],
  })

  return text.trim()
}

export async function runLightSleep(lookbackDays = 3): Promise<ConsolidationResult> {
  await ensureDirs()
  const todayStr = today()

  const transcripts = await readSessionTranscripts(lookbackDays)
  const dailyFiles = await readDailyMemoryFiles(lookbackDays)

  const snippets = [...transcripts, ...dailyFiles]
  if (!snippets.length) {
    return { phase: "light", entriesProcessed: 0, duplicatesMerged: 0, patternsFound: 0 }
  }

  const { patterns, duplicates } = await extractPatterns(snippets)

  const combinedSnippets = snippets
    .flatMap((s) => s.split("\n").filter((l) => l.trim().length > 10))
    .slice(0, 20)

  const diaryEntry = await generateDiaryNarrative("light", combinedSnippets, patterns)

  if (diaryEntry) {
    await writeDiaryEntry(
      todayStr,
      "light",
      [
        diaryEntry ? `**Narrative:** ${diaryEntry}` : "",
        patterns.length ? `**Patterns observed:** ${patterns.join(", ")}` : "",
        duplicates.length
          ? `**Duplicates found:** ${duplicates.map((d) => `${d.topic} (×${d.count})`).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
  }

  _lastLightRun = todayStr
  return {
    phase: "light",
    entriesProcessed: combinedSnippets.length,
    duplicatesMerged: duplicates.length,
    patternsFound: patterns.length,
    diaryEntry,
  }
}

export async function runRemSleep(): Promise<ConsolidationResult> {
  await ensureDirs()
  const todayStr = today()

  const memoryContent = await readMemoryFile()
  if (!memoryContent || memoryContent === "# Long-Term Memory\n\n") {
    return { phase: "rem", entriesProcessed: 0, duplicatesMerged: 0, patternsFound: 0 }
  }

  const sections = memoryContent.split("\n## ").filter((s) => s.trim().length > 0)

  const { patterns, duplicates } = await extractPatterns(sections)

  const diaryEntry = await generateDiaryNarrative("rem", sections, patterns)

  if (diaryEntry) {
    const path = dreamsPath()
    await mkdir(dirname(path), { recursive: true })
    const block = `### ${todayStr} — REM Sleep\n\n${diaryEntry}\n\n`
    let existing = ""
    try {
      existing = await readFile(path, "utf-8")
    } catch {
      existing = "# Dream Diary\n\n"
    }
    await writeFile(path, existing + block, "utf-8")
  }

  _lastRemRun = todayStr
  return {
    phase: "rem",
    entriesProcessed: sections.length,
    duplicatesMerged: duplicates.length,
    patternsFound: patterns.length,
    diaryEntry,
  }
}

export async function runDeepSleep(opts?: {
  minScore?: number
  minRecalls?: number
}): Promise<ConsolidationResult> {
  const result = await runPromotionCycle(opts)
  return {
    phase: "deep",
    entriesProcessed: result.candidates,
    duplicatesMerged: result.pruned,
    patternsFound: result.promoted,
    diaryEntry: `Promoted ${result.promoted} memories from ${result.candidates} candidates. Pruned ${result.pruned} stale entries.`,
  }
}

export async function runFullConsolidation(): Promise<ConsolidationResult[]> {
  if (_isRunning) return []
  _isRunning = true
  try {
    const light = await runLightSleep()
    const rem = await runRemSleep()
    const deep = await runDeepSleep()
    return [light, rem, deep]
  } finally {
    _isRunning = false
  }
}

export async function getConsolidationStatus(): Promise<{
  lastLightRun: string | null
  lastRemRun: string | null
  isRunning: boolean
}> {
  return {
    lastLightRun: _lastLightRun,
    lastRemRun: _lastRemRun,
    isRunning: _isRunning,
  }
}
