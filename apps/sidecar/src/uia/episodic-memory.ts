// Episodic Memory — stores task→result→failure→recovery paths.
// Learns from every automation run. Improves future planning.
// Persists to ~/.yomi/episodes/

import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface Episode {
  id: string
  startedAt: string
  endedAt: string
  app: string
  goal: string
  result: "success" | "failure" | "partial"
  actions: { tool: string; ok: boolean; durationMs: number }[]
  failures: { tool: string; error: string; recoveryAttempted: boolean; recovered: boolean }[]
  recoveryPath?: string[] // strategies tried
  learnedStrategy?: string // what worked in the end
}

const EPISODE_DIR = join(homedir(), ".yomi", "episodes")

export async function recordEpisode(episode: Episode): Promise<void> {
  await mkdir(EPISODE_DIR, { recursive: true })
  const date = episode.startedAt.slice(0, 10)
  const path = join(EPISODE_DIR, `${date}-${episode.id}.json`)
  await writeFile(path, JSON.stringify(episode, null, 2), "utf8")
}

export async function recallEpisode(id: string): Promise<Episode | null> {
  try {
    const files = await readdir(EPISODE_DIR)
    const match = files.find((f) => f.includes(id))
    if (!match) return null
    return JSON.parse(await readFile(join(EPISODE_DIR, match), "utf8")) as Episode
  } catch { return null }
}

export async function recallRecentEpisodes(app?: string, limit = 10): Promise<Episode[]> {
  try {
    const files = (await readdir(EPISODE_DIR)).filter((f) => f.endsWith(".json")).sort().reverse()
    const episodes: Episode[] = []
    for (const f of files.slice(0, limit * 3)) {
      const ep = JSON.parse(await readFile(join(EPISODE_DIR, f), "utf8")) as Episode
      if (!app || ep.app === app) episodes.push(ep)
      if (episodes.length >= limit) break
    }
    return episodes
  } catch { return [] }
}

export async function getSuccessRate(app: string, limit = 20): Promise<{ rate: number; total: number; successes: number }> {
  const eps = await recallRecentEpisodes(app, limit)
  const successes = eps.filter((e) => e.result === "success").length
  return { rate: eps.length > 0 ? successes / eps.length : 0, total: eps.length, successes }
}

export async function recallRecoveryPaths(app: string, goal: string): Promise<string[]> {
  const eps = await recallRecentEpisodes(app, 50)
  return eps
    .filter((e) => e.goal === goal && e.recoveryPath && e.recoveryPath.length > 0)
    .flatMap((e) => e.recoveryPath!)
}
