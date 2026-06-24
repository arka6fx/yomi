import { tool, jsonSchema } from "ai"

export function actFailed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false
  const r = result as Record<string, unknown>
  return r.ok === false || Boolean(r.error)
}

export function createSystemTools(ctx: { screenshotB64?: string }) {
  return {
    look_at_screen: tool({
      description: "Read the screenshot attached to this turn, when one is available.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
      }),
      execute: async () => {
        if (!ctx.screenshotB64) {
          return { error: "No screenshot is available for this turn." }
        }
        return { image_b64: ctx.screenshotB64, format: "png" }
      },
    }),

    bash: tool({
      description: "Run an allowlisted shell command for local files or diagnostics.",
      parameters: jsonSchema<{ command: string; explanation: string }>({
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          explanation: { type: "string", description: "What this command does and why" },
        },
        required: ["command", "explanation"],
      }),
      execute: async ({ command }) => {
        const proc = Bun.spawn(["sh", "-c", command], {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        })
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        const exitCode = await proc.exited
        return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
      },
    }),
  }
}
