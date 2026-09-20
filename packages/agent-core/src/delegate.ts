import { tool } from "ai"
import { z } from "zod"
import { runAgentLoop, type RunAgentLoopOptions, type UsageInfo } from "./agent.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

// Fixed, small, and non-configurable — this sub-loop is meant to be cheap and
// bounded by construction, not tuned. See design:
// specs/archive/superpowers/specs/2026-08-02-subagent-delegation-design.md
const DELEGATE_MAX_STEPS = 8
const DELEGATE_MAX_OUTPUT_TOKENS = 4096
const MAX_DELEGATIONS_PER_TURN = 3

export type DelegateRunLoopFn = (opts: RunAgentLoopOptions) => Promise<string>

export interface CreateDelegateToolOptions {
  registry: ConnectorRegistry
  model?: string
  system?: string
  signal?: AbortSignal
  onUsage?: (usage: UsageInfo) => void
  // Test-only override — production callers omit this and get the real
  // runAgentLoop. Keeps this file's tests from needing to mock a sibling
  // module, which packages/agent-core's non-isolated test run can't do
  // safely (see agent.test.ts, which tests the real runAgentLoop).
  runLoop?: DelegateRunLoopFn
}

// Depth is capped at 1 by construction: the sub-loop call below never sets
// extraTools, so a delegated sub-agent can never itself call delegate.
export function createDelegateTool(opts: CreateDelegateToolOptions) {
  const runLoop = opts.runLoop ?? runAgentLoop
  let calls = 0
  return tool({
    description:
      "Delegate a well-defined, self-contained sub-task to an isolated sub-agent. " +
      "Use this to break a complex request into independent pieces, or to keep a " +
      "long research/lookup step out of your own transcript. The sub-agent has " +
      "access to the same connected services you do, but no memory of this " +
      "conversation — describe the task completely and self-contained.",
    parameters: z.object({
      task: z
        .string()
        .min(1)
        .max(2000)
        .describe("A complete, self-contained description of the sub-task"),
    }),
    execute: async ({ task }) => {
      if (calls >= MAX_DELEGATIONS_PER_TURN) {
        return { error: `delegation limit (${MAX_DELEGATIONS_PER_TURN} per turn) reached` }
      }
      calls++
      try {
        const result = await runLoop({
          registry: opts.registry,
          text: task,
          model: opts.model,
          system: opts.system,
          maxSteps: DELEGATE_MAX_STEPS,
          maxOutputTokens: DELEGATE_MAX_OUTPUT_TOKENS,
          signal: opts.signal,
          onUsage: opts.onUsage,
        })
        return { result }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}
