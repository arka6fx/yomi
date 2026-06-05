import type { ToolSet } from "ai"
import { createAgentTools } from "../../tools/index.js"
import { getMcpTools } from "../../mcp/client.js"
import { wrapBrowserTools } from "../../mcp/safety.js"
import type { Hooks } from "../../harness/hooks.js"

type ExecutableTool = { execute?: (args: unknown, opts: unknown) => PromiseLike<unknown> }

// Wrap every tool's execute with PreToolUse / PostToolUse hooks (denylist + output trim).
// Identical contract to pipeline/agent.ts's applyHooks — kept local so the legacy file is untouched.
function applyHooks(tools: ToolSet, activeHooks: Hooks): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
          const check = await activeHooks.onPreToolUse(name, args)
          if (!check.ok) {
            console.warn(`[yomi/graph] denied: ${name} — ${check.reason}`)
            return `[DENIED: ${check.reason}]`
          }
          const result = await (t as ExecutableTool).execute?.(args, opts)
          return activeHooks.onPostToolUse(name, result)
        },
      },
    ]),
  ) as ToolSet
}

// Build the merged agent tool set (native + memory + web + Playwright MCP) behind the safety
// hooks. Browser tools degrade gracefully when the MCP server is unavailable.
export async function buildAgentToolSet(
  ctx: { screenshotB64?: string; background?: boolean },
  activeHooks: Hooks,
): Promise<ToolSet> {
  const mcpTools = wrapBrowserTools(await getMcpTools())
  return applyHooks({ ...createAgentTools(ctx), ...mcpTools }, activeHooks)
}
