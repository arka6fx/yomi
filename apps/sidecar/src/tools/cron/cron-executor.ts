// Cron job executor — runs a single job with timeout, restricted tools, and threat scanning.
// Each job runs as a non-streaming generateText call with a 3-min hard interrupt.

import { generateText } from "ai"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createModel } from "../../pipeline/model.js"
import { createMemoryTools } from "../memory.js"
import { createWebTools } from "../web.js"
import { createSystemTools } from "../system.js"
import { createSkillTools } from "../skills/index.js"
import { scanForThreats } from "../guardrails/index.js"
import { notepadDir } from "../../memory/loader.js"
import { saveCronOutput } from "./cron-store.js"
import type { CronJob, CronJobResult } from "./cron-types.js"

const CRON_AGENT_MODEL = process.env["CRON_AGENT_MODEL"] || "gpt-4.1-mini"
const CRON_TIMEOUT_MS = 180_000 // 3 minutes

// Tools that cron sessions are NOT allowed to use.
const CRON_BLOCKED_TOOLS = new Set([
  "cronjob",
  "send_whatsapp_message",
])

function buildCronToolSet() {
  const all = {
    ...createMemoryTools(),
    ...createWebTools(),
    ...createSystemTools({}),
    ...createSkillTools({}),
  }
  return Object.fromEntries(
    Object.entries(all).filter(([name]) => !CRON_BLOCKED_TOOLS.has(name)),
  )
}

async function loadJobSkills(skills: string[]): Promise<string> {
  const blocks: string[] = []
  for (const name of skills) {
    try {
      const path = join(notepadDir(), "skills", name, "SKILL.md")
      const content = await readFile(path, "utf-8")
      blocks.push(`<skill name="${name}">\n${content}\n</skill>`)
    } catch {
      console.warn(`[cron] skill "${name}" not found, skipping`)
    }
  }
  return blocks.join("\n\n")
}

async function runScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", ["/c", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on("data", (d: Buffer) => stdout.push(d))
    child.stderr?.on("data", (d: Buffer) => stderr.push(d))
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf-8"))
      } else {
        const err = Buffer.concat(stderr).toString("utf-8")
        resolve(`exit code ${code}\n${err}`)
      }
    })
    child.on("error", reject)
  })
}

async function loadContextFromJob(
  contextFrom: string,
): Promise<string> {
  const outputDir = join(notepadDir(), "cron", "output", contextFrom)
  try {
    const { readdir } = await import("node:fs/promises")
    const files = await readdir(outputDir)
    if (files.length === 0) return ""
    const latest = files.sort().reverse()[0]!
    const content = await readFile(join(outputDir, latest), "utf-8")
    return `Previous job output (${contextFrom}):\n${content.slice(0, 4000)}`
  } catch {
    return ""
  }
}

async function loadWorkdirContext(workdir: string): Promise<string> {
  try {
    const content = await readFile(join(workdir, "AGENTS.md"), "utf-8")
    return `Working directory context:\n${content}`
  } catch {
    return ""
  }
}

function assembleSystemPrompt(job: CronJob, extra: string[]): string {
  const parts = [
    "You are Yomi running a scheduled cron job.",
    `Task: ${job.prompt}`,
    "",
    "Rules:",
    "- You have access to the user's filesystem and can search the web.",
    "- Keep responses concise and actionable.",
    "- This is a scheduled run — there is no user to interact with directly.",
    "- Do not use cronjob tool, messaging tools, or clarification tools.",
    "- Do not wait for user input.",
    "- Provide a complete result in a single response.",
    "",
    ...extra,
  ]
  return parts.join("\n")
}

export async function executeCronJob(
  job: CronJob,
  parentSignal?: AbortSignal,
): Promise<CronJobResult> {
  const start = Date.now()

  // Build timeout signal
  const timeoutSignal = AbortSignal.timeout(CRON_TIMEOUT_MS)
  const combinedSignal = parentSignal
    ? anySignal([timeoutSignal, parentSignal])
    : timeoutSignal

  try {
    // --- Assemble context ---
    const contextBlocks: string[] = []

    if (job.skills && job.skills.length > 0) {
      const skillsBlock = await loadJobSkills(job.skills)
      if (skillsBlock) contextBlocks.push(skillsBlock)
    }

    if (job.contextFrom) {
      const chainBlock = await loadContextFromJob(job.contextFrom)
      if (chainBlock) contextBlocks.push(chainBlock)
    }

    if (job.workdir) {
      const workdirBlock = await loadWorkdirContext(job.workdir)
      if (workdirBlock) contextBlocks.push(workdirBlock)
    }

    const systemPrompt = assembleSystemPrompt(job, contextBlocks)

    // --- Pre-flight threat scan ---
    const findings = scanForThreats(systemPrompt, "all")
    if (findings.length > 0) {
      const durationMs = Date.now() - start
      return {
        ok: false,
        jobId: job.id,
        error: `threat_block: ${findings[0]}`,
        durationMs,
      }
    }

    // --- Script-only mode ---
    if (job.noAgent) {
      if (!job.script) {
        return { ok: false, jobId: job.id, error: "noAgent set but no script provided", durationMs: Date.now() - start }
      }
      const output = await runScript(job.script)
      const outputPath = await saveCronOutput(job.id, output)
      return {
        ok: true,
        jobId: job.id,
        outputPath,
        outputPreview: output.slice(0, 500),
        durationMs: Date.now() - start,
      }
    }

    // --- Agent mode ---
    const tools = buildCronToolSet()
    const modelId = job.model ?? CRON_AGENT_MODEL

    let scriptOutput = ""
    if (job.script) {
      scriptOutput = await runScript(job.script)
    }

    const messages = [
      ...(scriptOutput
        ? [{ role: "user" as const, content: `Script output:\n${scriptOutput}\n\nJob: ${job.prompt}` }]
        : [{ role: "user" as const, content: job.prompt }]),
    ]

    const result = await generateText({
      model: createModel(modelId),
      system: systemPrompt,
      messages,
      tools,
      maxSteps: 10,
      abortSignal: combinedSignal,
    })

    const output = result.text || "(no output)"
    const outputPath = await saveCronOutput(job.id, output)

    return {
      ok: true,
      jobId: job.id,
      outputPath,
      outputPreview: output.slice(0, 500),
      durationMs: Date.now() - start,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    const outputPath = await saveCronOutput(job.id, `ERROR: ${message}`).catch(() => undefined)
    return {
      ok: false,
      jobId: job.id,
      outputPath,
      error: message,
      durationMs,
    }
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}
