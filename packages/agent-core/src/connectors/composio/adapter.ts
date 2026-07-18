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
              return await opts.executor.execute({
                userId: ctx.userId,
                slug: spec.slug,
                arguments: args,
              })
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
              () =>
                opts.executor.execute({ userId: ctx.userId, slug: spec.slug, arguments: args }),
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
