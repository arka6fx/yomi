import { tool, jsonSchema } from "ai"
import type { Plan } from "@yomi/shared"
import { runSubagent, runSubagentBatch } from "./index.js"
import type { SubagentRole, SubagentRunOptions, SubagentResult } from "./index.js"

function checkPlanAccess(plan: Plan | undefined, role: SubagentRole): string | null {
  if (role === "orchestrator" && plan !== "max") {
    return "orchestrator role requires a Max plan"
  }
  return null
}

export interface DelegateTaskSingleArgs {
  goal: string
  context?: string[]
  toolsets?: string[]
  role?: SubagentRole
}

export interface DelegateTaskBatchArgs {
  tasks: SubagentRunOptions[]
  concurrency?: number
}

type DelegateTaskArgs = DelegateTaskSingleArgs | DelegateTaskBatchArgs

function isSingle(args: DelegateTaskArgs): args is DelegateTaskSingleArgs {
  return "goal" in args && typeof (args as DelegateTaskSingleArgs).goal === "string"
}

function isBatch(args: DelegateTaskArgs): args is DelegateTaskBatchArgs {
  return "tasks" in args && Array.isArray((args as DelegateTaskBatchArgs).tasks)
}

export function createDelegateTaskTool(ctx: { plan?: Plan }) {
  return {
    delegate_task: tool({
      description:
        "Delegate a subtask to a subagent. Provide either a single goal (single delegation) " +
        "or an array of tasks (parallel batch). Leaf subagents can only read files and search; " +
        "orchestrator subagents (Max-only) can run bash and create skills. " +
        'Example: { goal: "Audit package.json" } or { tasks: [{ goal: "..." }, { goal: "..." }] }.',
      parameters: jsonSchema<DelegateTaskArgs>({
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "Single goal for a subagent (use instead of tasks for one-off work).",
          },
          context: {
            type: "array",
            items: { type: "string" },
            description: "Notepad-relative file paths to preload as context.",
          },
          toolsets: {
            type: "array",
            items: { type: "string" },
            description: "Tool category hints (v1: advisory only).",
          },
          role: {
            type: "string",
            enum: ["leaf", "orchestrator"],
            description: "Subagent role (default leaf). Orchestrator is Max-only.",
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                goal: { type: "string" },
                role: { type: "string", enum: ["leaf", "orchestrator"] },
                context: { type: "array", items: { type: "string" } },
                toolsets: { type: "array", items: { type: "string" } },
              },
              required: ["goal"],
            },
            description: "Parallel batch of subagent tasks (use instead of goal).",
          },
          concurrency: {
            type: "number",
            description: "Max concurrent subagents (default 3, max 5).",
          },
        },
        // goal and tasks are both optional at the JSON level; we validate at runtime
        // that exactly one is present.
      }),
      execute: async (args: DelegateTaskArgs) => {
        const hasGoal = isSingle(args)
        const hasTasks = isBatch(args)

        if (hasGoal && hasTasks) {
          return { ok: false, error: "Provide either goal or tasks, not both." }
        }
        if (!hasGoal && !hasTasks) {
          return { ok: false, error: "Provide either goal (single) or tasks (batch)." }
        }

        if (hasGoal) {
          const role = args.role ?? "leaf"
          const planError = checkPlanAccess(ctx.plan, role)
          if (planError) return { ok: false, error: planError }

          const result = await runSubagent({
            role,
            goal: args.goal,
            context: args.context,
            toolsets: args.toolsets,
            plan: ctx.plan,
          })

          return {
            ok: result.ok,
            summary: result.summary,
            tool_calls: result.toolCalls,
            role,
            error: result.error,
          }
        }

        // Batch path
        if (hasTasks) {
          const concurrency = args.concurrency ?? 3
          if (concurrency < 1) return { ok: false, error: "concurrency must be >= 1" }
          if (concurrency > 5) return { ok: false, error: "concurrency max is 5" }

          const enriched = args.tasks.map((t) => ({
            ...t,
            plan: ctx.plan,
          }))

          const results = await runSubagentBatch({ tasks: enriched, concurrency })

          return {
            ok: results.every((r) => r.ok),
            results: results.map((r) => ({
              ok: r.ok,
              summary: r.summary,
              tool_calls: r.toolCalls,
              role: r.messages.length > 0 ? ("leaf" as SubagentRole) : undefined,
              error: r.error,
            })),
          }
        }

        return { ok: false, error: "unexpected state" }
      },
    }),
  }
}
