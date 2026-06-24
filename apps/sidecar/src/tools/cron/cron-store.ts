// File-based job store — reads/writes sidecar app-data cron/jobs.json atomically.
// Tick lock prevents duplicate ticks across processes.

import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { notepadDir } from "../../memory/loader.js"
import type { CronJob, CronJobStore } from "./cron-types.js"

const TICK_LOCK_TTL_MS = 60_000

function storePath(): string {
  return join(notepadDir(), "cron", "jobs.json")
}

function lockPath(): string {
  return join(notepadDir(), "cron", ".tick.lock")
}

function outputDir(jobId: string): string {
  return join(notepadDir(), "cron", "output", jobId)
}

export async function loadJobs(): Promise<Record<string, CronJob>> {
  try {
    const raw = await readFile(storePath(), "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const store = parsed as CronJobStore
      return store.jobs ?? {}
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[cron] corrupt jobs.json, starting fresh:", err)
    }
  }
  return {}
}

export async function saveJobs(jobs: Record<string, CronJob>): Promise<void> {
  const store: CronJobStore = { version: 1, jobs }
  const path = storePath()
  await mkdir(join(notepadDir(), "cron"), { recursive: true })
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf-8")
  await rename(tmp, path)
}

export async function loadJob(jobId: string): Promise<CronJob | null> {
  const jobs = await loadJobs()
  return jobs[jobId] ?? null
}

export async function saveJob(job: CronJob): Promise<void> {
  const jobs = await loadJobs()
  jobs[job.id] = job
  await saveJobs(jobs)
}

export async function deleteJob(jobId: string): Promise<boolean> {
  const jobs = await loadJobs()
  if (!(jobId in jobs)) return false
  delete jobs[jobId]
  await saveJobs(jobs)
  return true
}

export async function acquireTickLock(): Promise<boolean> {
  const path = lockPath()
  try {
    const { stat } = await import("node:fs/promises")
    const st = await stat(path)
    const age = Date.now() - st.mtimeMs
    if (age < TICK_LOCK_TTL_MS) return false
  } catch {
    // ENOENT — lock is free
  }
  try {
    await mkdir(join(notepadDir(), "cron"), { recursive: true })
    await writeFile(path, String(Date.now()), "utf-8")
    return true
  } catch {
    return false
  }
}

export async function releaseTickLock(): Promise<void> {
  try {
    await unlink(lockPath())
  } catch {
    // Best-effort
  }
}

export async function saveCronOutput(
  jobId: string,
  content: string,
): Promise<string> {
  const dir = outputDir(jobId)
  await mkdir(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const path = join(dir, `${timestamp}.md`)
  await writeFile(path, content, "utf-8")
  return path
}
