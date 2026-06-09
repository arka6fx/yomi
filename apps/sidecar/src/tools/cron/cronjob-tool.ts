// Cron job management tool — create, list, view, update, delete, pause, resume.
// Added to the shared tool set so the agent can manage jobs from conversation.

import { tool, jsonSchema, type ToolSet } from "ai"
import type { Plan } from "@yomi/shared"
import type { CronJob } from "./cron-types.js"
import { checkCronAccess, validateScheduleInput, cronLimitForPlan } from "./cron-types.js"
import { loadJobs, saveJobs, loadJob, deleteJob } from "./cron-store.js"

type CronAction =
  | "create"
  | "list"
  | "view"
  | "update"
  | "delete"
  | "pause"
  | "resume"

export interface CronJobToolArgs {
  action: CronAction
  id?: string
  schedule?: string
  prompt?: string
  skills?: string[]
  model?: string
  provider?: string
  script?: string
  noAgent?: boolean
  contextFrom?: string
  workdir?: string
  deliverTo?: string[]
}

function generateJobId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `cron-${ts}-${rand}`
}

function jobToSummary(job: CronJob): Record<string, unknown> {
  return {
    id: job.id,
    schedule: job.schedule,
    scheduleType: job.scheduleType,
    prompt: job.prompt.slice(0, 200),
    enabled: job.enabled,
    oneShot: job.oneShot,
    lastRunAt: job.lastRunAt ?? "never",
    lastRunStatus: job.lastRunStatus ?? "never",
    runCount: job.runCount,
    skills: job.skills,
    model: job.model,
    script: job.script,
    noAgent: job.noAgent,
    contextFrom: job.contextFrom,
    workdir: job.workdir,
  }
}

export function createCronJobTool(ctx: { plan?: Plan }): ToolSet {
  return {
    cronjob: tool({
      description:
        "Manage scheduled cron jobs. Actions: create, list, view, update, delete, pause, resume. " +
        "Cron is a Pro feature. Schedule formats: duration ('30m', '2h', '1d'), " +
        "cron expression ('0 9 * * *'), phrase ('every monday 9am'), or ISO timestamp. " +
        "Jobs can load skills, override model/provider, run a data-collection script, " +
        "chain output from another job, and set a working directory.",
      parameters: jsonSchema<CronJobToolArgs>({
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "list", "view", "update", "delete", "pause", "resume"],
            description: "What to do with cron jobs.",
          },
          id: {
            type: "string",
            description: "Job ID (required for view, update, delete, pause, resume; optional for create).",
          },
          schedule: {
            type: "string",
            description: 'Schedule string: "30m", "2h", "1d", "0 9 * * *", "every monday 9am", or ISO timestamp.',
          },
          prompt: {
            type: "string",
            description: "The instruction to run when the job fires.",
          },
          skills: {
            type: "array",
            items: { type: "string" },
            description: "Skill names to load for this job.",
          },
          model: {
            type: "string",
            description: "Model override (e.g. 'gpt-4.1').",
          },
          provider: {
            type: "string",
            description: "Provider override.",
          },
          script: {
            type: "string",
            description: "Shell command to run before the agent (stdout → prompt context).",
          },
          noAgent: {
            type: "boolean",
            description: "If true, run script only — no AI agent spawned.",
          },
          contextFrom: {
            type: "string",
            description: "Job ID whose latest output to chain into this job's prompt.",
          },
          workdir: {
            type: "string",
            description: "Working directory (loads AGENTS.md from there).",
          },
          deliverTo: {
            type: "array",
            items: { type: "string" },
            description: "Platform(s) to deliver results (future).",
          },
        },
        required: ["action"],
      }),
      execute: async (args: CronJobToolArgs) => {
        const plan = ctx.plan

        switch (args.action) {
          case "list": {
            if (!checkCronAccess(plan, "list", 0).ok) {
              return { ok: false, error: checkCronAccess(plan, "list", 0).reason }
            }
            const jobs = await loadJobs()
            const summaries = Object.values(jobs).map(jobToSummary)
            return { ok: true, jobs: summaries, count: summaries.length }
          }

          case "view": {
            if (!args.id) return { ok: false, error: "id is required for view" }
            const job = await loadJob(args.id)
            if (!job) return { ok: false, error: `job "${args.id}" not found` }
            return { ok: true, job: jobToSummary(job) }
          }

          case "create": {
            if (!args.schedule) return { ok: false, error: "schedule is required" }
            if (!args.prompt) return { ok: false, error: "prompt is required" }

            const scheduleCheck = validateScheduleInput(args.schedule)
            if (!scheduleCheck.ok) {
              return { ok: false, error: scheduleCheck.error }
            }

            const jobs = await loadJobs()
            const currentCount = Object.keys(jobs).length
            const access = checkCronAccess(plan, "create", currentCount)
            if (!access.ok) {
              return { ok: false, error: access.reason, upgrade_url: "https://yomi.example.com/upgrade" }
            }

            const now = new Date().toISOString()
            const id = args.id || generateJobId()

            if (jobs[id]) {
              return { ok: false, error: `job "${id}" already exists. Use update to modify or specify a different id.` }
            }

            const job: CronJob = {
              id,
              schedule: args.schedule,
              scheduleType: scheduleCheck.scheduleType!,
              prompt: args.prompt,
              skills: args.skills,
              model: args.model,
              provider: args.provider,
              script: args.script,
              noAgent: args.noAgent,
              contextFrom: args.contextFrom,
              workdir: args.workdir,
              deliverTo: args.deliverTo,
              enabled: true,
              oneShot: scheduleCheck.scheduleType === "iso",
              createdAt: now,
              updatedAt: now,
              lastRunAt: null,
              lastRunStatus: null,
              runCount: 0,
            }

            jobs[id] = job
            await saveJobs(jobs)

            return {
              ok: true,
              id,
              schedule: job.schedule,
              scheduleType: job.scheduleType,
              jobsTotal: Object.keys(jobs).length,
              jobsLimit: cronLimitForPlan(plan),
            }
          }

          case "update": {
            if (!args.id) return { ok: false, error: "id is required for update" }
            const existing = await loadJob(args.id)
            if (!existing) return { ok: false, error: `job "${args.id}" not found` }

            let scheduleType = existing.scheduleType
            if (args.schedule) {
              const scheduleCheck = validateScheduleInput(args.schedule)
              if (!scheduleCheck.ok) return { ok: false, error: scheduleCheck.error }
              scheduleType = scheduleCheck.scheduleType!
            }

            const updated: CronJob = {
              ...existing,
              schedule: args.schedule ?? existing.schedule,
              scheduleType,
              prompt: args.prompt ?? existing.prompt,
              skills: args.skills ?? existing.skills,
              model: args.model !== undefined ? args.model : existing.model,
              provider: args.provider !== undefined ? args.provider : existing.provider,
              script: args.script !== undefined ? args.script : existing.script,
              noAgent: args.noAgent ?? existing.noAgent,
              contextFrom: args.contextFrom !== undefined ? args.contextFrom : existing.contextFrom,
              workdir: args.workdir !== undefined ? args.workdir : existing.workdir,
              deliverTo: args.deliverTo ?? existing.deliverTo,
              updatedAt: new Date().toISOString(),
            }

            const jobs = await loadJobs()
            jobs[updated.id] = updated
            await saveJobs(jobs)

            return { ok: true, id: updated.id, updated: jobToSummary(updated) }
          }

          case "delete": {
            if (!args.id) return { ok: false, error: "id is required for delete" }
            const deleted = await deleteJob(args.id)
            if (!deleted) return { ok: false, error: `job "${args.id}" not found` }
            return { ok: true, id: args.id, deleted: true }
          }

          case "pause": {
            if (!args.id) return { ok: false, error: "id is required for pause" }
            const jobs = await loadJobs()
            if (!jobs[args.id]) return { ok: false, error: `job "${args.id}" not found` }
            jobs[args.id]!.enabled = false
            jobs[args.id]!.updatedAt = new Date().toISOString()
            await saveJobs(jobs)
            return { ok: true, id: args.id, enabled: false }
          }

          case "resume": {
            if (!args.id) return { ok: false, error: "id is required for resume" }
            const jobs = await loadJobs()
            if (!jobs[args.id]) return { ok: false, error: `job "${args.id}" not found` }
            jobs[args.id]!.enabled = true
            jobs[args.id]!.updatedAt = new Date().toISOString()
            await saveJobs(jobs)
            return { ok: true, id: args.id, enabled: true }
          }

          default:
            return { ok: false, error: `unknown action: ${(args as { action: string }).action}` }
        }
      },
    }),
  }
}
