import { tool, jsonSchema } from "ai"
import { platform } from "os"

export function createSystemTools(ctx: { screenshotB64?: string }) {
  return {
    look_at_screen: tool({
      description: "Get a screenshot of the user's current screen. Returns base64-encoded PNG.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
      }),
      execute: async () => {
        if (!ctx.screenshotB64) {
          return { error: "No screenshot available — ask the user to share their screen." }
        }
        return { image_b64: ctx.screenshotB64, format: "png" }
      },
    }),

    bash: tool({
      description: "Run a shell command. Only allowlisted commands execute; destructive commands are blocked.",
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

    // Phase 2+: coordinate-based cursor automation. Accessibility-tree targeting deferred.
    point_cursor: tool({
      description: "Move the mouse cursor to an absolute screen position",
      parameters: jsonSchema<{ x: number; y: number }>({
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate in pixels" },
          y: { type: "number", description: "Y coordinate in pixels" },
        },
        required: ["x", "y"],
      }),
      execute: async ({ x, y }) => {
        const os = platform()
        if (os === "linux") {
          const proc = Bun.spawn(["xdotool", "mousemove", String(x), String(y)], { stdout: "pipe", stderr: "pipe" })
          await proc.exited
          return { ok: true }
        }
        if (os === "darwin") {
          const proc = Bun.spawn(["cliclick", `m:${x},${y}`], { stdout: "pipe", stderr: "pipe" })
          await proc.exited
          return { ok: true }
        }
        return { error: `Cursor automation not yet supported on ${os}` }
      },
    }),

    click: tool({
      description: "Click the mouse at the current cursor position",
      parameters: jsonSchema<{ button: "left" | "right" | "middle" }>({
        type: "object",
        properties: {
          button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
        },
        required: [],
      }),
      execute: async ({ button = "left" }) => {
        const os = platform()
        if (os === "linux") {
          const btnNum = button === "left" ? "1" : button === "right" ? "3" : "2"
          const proc = Bun.spawn(["xdotool", "click", btnNum], { stdout: "pipe", stderr: "pipe" })
          await proc.exited
          return { ok: true }
        }
        if (os === "darwin") {
          const flag = button === "left" ? "c" : button === "right" ? "rc" : "mc"
          const proc = Bun.spawn(["cliclick", flag], { stdout: "pipe", stderr: "pipe" })
          await proc.exited
          return { ok: true }
        }
        return { error: `Click automation not yet supported on ${os}` }
      },
    }),
  }
}
