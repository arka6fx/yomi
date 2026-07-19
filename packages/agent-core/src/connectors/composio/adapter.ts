import { tool, type ToolSet } from "ai"
import type { z } from "zod"
import type { ConnectorContext, ToolFactory } from "../connector-def.js"
import { connectorError, gateWrite } from "../connector-def.js"
import { classifyAction, type ActionRisk } from "./classification.js"

// Remote tool executor. Production wraps Composio's execute (REST or SDK); tests
// inject a fake. `arguments` is the tool's validated args; the return value is the
// tool result surfaced back to the agent.
export interface ComposioExecutor {
  execute(input: { userId: string; slug: string; arguments: unknown }): Promise<unknown>
}

// One tool the toolkit surfaces to the agent. `slug` is Composio's action id and
// becomes the tool key (so the pending-action executor can replay it by name).
export interface ComposioToolSpec {
  slug: string
  description: string
  parameters: z.ZodTypeAny
  // Builds the approval-card title/preview for a gated (write) action from its
  // args. Falls back to the slug + JSON args when omitted.
  preview?: (args: Record<string, unknown>) => { title: string; preview: string; confirmText?: string }
}

export interface CreateComposioToolsOptions {
  // Connector id stored in mcp_connections and used as the pending-action connector.
  provider: string
  // Composio toolkit slug used to classify actions (e.g. "linear").
  toolkit: string
  specs: ComposioToolSpec[]
  executor: ComposioExecutor
  // Override the classifier (defaults to the shared default-deny map).
  classify?: (toolkit: string, slug: string) => ActionRisk
}

function defaultPreview(
  slug: string,
  args: Record<string, unknown>,
): { title: string; preview: string; confirmText?: string } {
  const title = slug.replace(/_/g, " ").toLowerCase()
  return { title, preview: JSON.stringify(args).slice(0, 800) }
}

// Composio actions return whatever shape the provider's API gives back — full email
// bodies/HTML, entire thread histories, attachment payloads — with no size contract.
// Native connectors truncate per-field at the source (see google-gmail-def.ts's
// `.slice()` calls); Composio results have no known shape here, so cap total
// serialized size instead. Without this a single "fetch important mail" call was
// seen returning ~1M tokens of raw Gmail JSON and blowing the model's TPM limit.
const MAX_RESULT_CHARS = 20_000

function truncateResult(value: unknown, budget: { remaining: number }): unknown {
  if (budget.remaining <= 0) return "…[truncated]"
  if (typeof value === "string") {
    if (value.length <= budget.remaining) {
      budget.remaining -= value.length
      return value
    }
    const kept = value.slice(0, budget.remaining)
    const omitted = value.length - kept.length
    budget.remaining = 0
    return `${kept}…[truncated, ${omitted} more chars]`
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) {
      if (budget.remaining <= 0) {
        out.push(`…[truncated, ${value.length - out.length} more items]`)
        break
      }
      out.push(truncateResult(item, budget))
    }
    return out
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = budget.remaining <= 0 ? "…[truncated]" : truncateResult(v, budget)
    }
    return out
  }
  return value
}

// Single chokepoint every Composio tool result passes through before reaching the
// model, regardless of toolkit (Gmail, GitHub, Notion, Slack, ...).
function capComposioResult(result: unknown): unknown {
  return truncateResult(result, { remaining: MAX_RESULT_CHARS })
}

// Wraps a Composio toolkit as an AI SDK ToolSet behind Yomi's approval flow.
//
// For each spec the risk map decides the path: `read` actions execute straight
// through the injected executor and return the result; every other risk routes
// through `ctx.createPendingAction` (via gateWrite) and does NOT touch the
// provider — the real executor runs only on approval replay, when the backend
// rebuilds these tools with no `createPendingAction` on the ctx. This mirrors the
// native connectors' gateWrite semantics, so approval + replay behave identically.
export function createComposioTools(opts: CreateComposioToolsOptions): ToolFactory {
  const classify = opts.classify ?? classifyAction

  return function composioTools(ctx: ConnectorContext): ToolSet {
    const set: ToolSet = {}

    for (const spec of opts.specs) {
      const risk = classify(opts.toolkit, spec.slug)

      set[spec.slug] = tool({
        description: spec.description,
        parameters: spec.parameters,
        execute: async (args: Record<string, unknown>) => {
          try {
            if (risk === "read") {
              const result = await opts.executor.execute({
                userId: ctx.userId,
                slug: spec.slug,
                arguments: args,
              })
              return capComposioResult(result)
            }

            const card = spec.preview ? spec.preview(args) : defaultPreview(spec.slug, args)
            return await gateWrite(
              ctx,
              {
                connector: opts.provider,
                action: spec.slug,
                risk,
                title: card.title,
                preview: card.preview,
                confirmText: card.confirmText,
              },
              args,
              async () =>
                capComposioResult(
                  await opts.executor.execute({ userId: ctx.userId, slug: spec.slug, arguments: args }),
                ),
            )
          } catch (err) {
            return connectorError(err)
          }
        },
      })
    }

    return set
  }
}
