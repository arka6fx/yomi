import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { listHistoryTurns, deleteHistoryTurn, type ChatTurn } from "./memory/chat-history.js"
import { notepadDir } from "./memory/loader.js"
import { loadJobs, saveJobs, deleteJob } from "./tools/cron/cron-store.js"
import { validateScheduleInput, type CronJob } from "./tools/cron/cron-types.js"

export type MemoryEntry = {
  id: string
  kind: string
  scope: string
  topic: string
  content: string
  confidence: number
  sourceType?: string | null
  sourcePath?: string | null
  customId?: string | null
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string
}

export type Diagnostics = {
  status: "ok"
  dataDir: string
  sessions: { files: number; turns: number }
  cron: { jobs: number; enabled: number; failed: number }
  env: {
    backendConfigured: boolean
    sessionTokenPresent: boolean
    elevenLabsConfigured: boolean
    aiCreditsConfigured: boolean
  }
}

function backendBaseUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function sessionToken(): string {
  return process.env["YOMI_SESSION_TOKEN"] ?? ""
}

async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionToken()
  if (!token) throw new Error("Sign in to manage cloud memories")
  const res = await fetch(`${backendBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Backend request failed (${res.status})`)
  return data
}

export async function listSessions(
  opts: { limit?: number; query?: string } = {},
): Promise<ChatTurn[]> {
  return listHistoryTurns(opts.limit ?? 100, opts.query)
}

export async function removeSessionTurn(id: number): Promise<boolean> {
  return deleteHistoryTurn(id)
}

export async function listMemories(limit = 100): Promise<MemoryEntry[]> {
  const data = await backendJson<{ memories?: MemoryEntry[] }>(
    `/api/memory/entries?limit=${encodeURIComponent(String(limit))}`,
  )
  return data.memories ?? []
}

export async function searchMemories(query: string, limit = 50): Promise<MemoryEntry[]> {
  const data = await backendJson<{ memories?: MemoryEntry[] }>("/api/memory/search", {
    method: "POST",
    body: JSON.stringify({ query, limit, maxChars: 12000 }),
  })
  return data.memories ?? []
}

export async function addMemory(
  input: Partial<MemoryEntry> & { content: string },
): Promise<MemoryEntry> {
  const data = await backendJson<{ memory?: MemoryEntry }>("/api/memory/add", {
    method: "POST",
    body: JSON.stringify({ kind: "fact", scope: "global", confidence: 80, ...input }),
  })
  if (!data.memory) throw new Error("Backend did not return a memory")
  return data.memory
}

export async function forgetMemory(
  id: string,
  hard = false,
): Promise<{ forgotten?: number; deleted?: number; ids?: string[] }> {
  return backendJson("/api/memory/forget", { method: "POST", body: JSON.stringify({ id, hard }) })
}

export async function listSchedules(): Promise<CronJob[]> {
  const jobs = await loadJobs()
  return Object.values(jobs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function upsertSchedule(input: {
  id?: string
  schedule: string
  prompt: string
  deliverTo?: string[]
  enabled?: boolean
}): Promise<CronJob> {
  const scheduleCheck = validateScheduleInput(input.schedule)
  if (!scheduleCheck.ok || !scheduleCheck.scheduleType)
    throw new Error(scheduleCheck.error ?? "Invalid schedule")
  const jobs = await loadJobs()
  const now = new Date().toISOString()
  const id = input.id ?? `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const existing = jobs[id]
  const job: CronJob = {
    id,
    schedule: input.schedule,
    scheduleType: scheduleCheck.scheduleType,
    prompt: input.prompt,
    deliverTo: input.deliverTo,
    enabled: input.enabled ?? existing?.enabled ?? true,
    oneShot: scheduleCheck.scheduleType === "iso",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt ?? null,
    lastRunStatus: existing?.lastRunStatus ?? null,
    runCount: existing?.runCount ?? 0,
  }
  jobs[id] = job
  await saveJobs(jobs)
  return job
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<CronJob | null> {
  const jobs = await loadJobs()
  const job = jobs[id]
  if (!job) return null
  job.enabled = enabled
  job.updatedAt = new Date().toISOString()
  await saveJobs(jobs)
  return job
}

export async function removeSchedule(id: string): Promise<boolean> {
  return deleteJob(id)
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const dir = notepadDir()
  const [turns, jobs] = await Promise.all([listHistoryTurns(10000), loadJobs()])
  let sessionFiles = 0
  try {
    sessionFiles = (await readdir(join(dir, "sessions"))).filter((file) =>
      file.endsWith(".jsonl"),
    ).length
  } catch {
    sessionFiles = 0
  }
  await stat(dir).catch(() => null)
  const jobList = Object.values(jobs)
  return {
    status: "ok",
    dataDir: dir,
    sessions: { files: sessionFiles, turns: turns.length },
    cron: {
      jobs: jobList.length,
      enabled: jobList.filter((job) => job.enabled).length,
      failed: jobList.filter((job) => job.lastRunStatus === "error").length,
    },
    env: {
      backendConfigured: Boolean(process.env["YOMI_BACKEND_URL"] || process.env["BACKEND_URL"]),
      sessionTokenPresent: Boolean(sessionToken()),
      elevenLabsConfigured: Boolean(process.env["ELEVENLABS_API_KEY"]),
      aiCreditsConfigured: Boolean(process.env["OPENAI_API_KEY"]),
    },
  }
}

export async function readRecentLogs(limit = 200): Promise<string[]> {
  const logDir = join(notepadDir(), "debug")
  const files = await readdir(logDir).catch(() => [])
  const lines: string[] = []
  for (const file of files.filter((name) => name.endsWith(".log")).slice(-5)) {
    const content = await readFile(join(logDir, file), "utf-8").catch(() => "")
    lines.push(...content.split("\n").filter(Boolean))
  }
  return lines.slice(-limit)
}
