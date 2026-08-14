import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorContext, ToolFactory } from "../connector-def.js"
import { connectorError, gateWrite } from "../connector-def.js"

// Composio's own { error: "..." } result (the 200-but-successful:false shape) is a
// normal RETURN value, not a thrown exception — connectorError()'s reconnect/hint
// detection only ran on throws, so a read action's real auth failure (e.g. a 401
// from the underlying provider) reached the model as raw, unhinted text and left
// it guessing "not connected" instead of "reconnect". Runs every read result
// through the same detection connectorError() already does for throws.
function enrichReadError(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result
  const record = result as Record<string, unknown>
  if (typeof record["error"] !== "string") return result
  return { ...record, ...connectorError(record["error"]) }
}
import { classifyAction, type ActionRisk } from "./classification.js"

// Remote tool executor. Production wraps Composio's execute (REST or SDK); tests
// inject a fake. `arguments` is the tool's validated args; the return value is the
// tool result surfaced back to the agent.
export interface ComposioExecutor {
  execute(input: { userId: string; slug: string; arguments: unknown }): Promise<unknown>
  // Stages a file at `url` through Composio's upload pipeline and returns the
  // `{name, mimetype, s3key}` descriptor their tools expect in place of a raw
  // file value. Optional: only the real REST executor implements it; fakes in
  // tests can omit it for specs with no fileParams.
  stageFile?(input: {
    url: string
    toolSlug: string
    toolkitSlug: string
  }): Promise<{ name: string; mimetype: string; s3key: string }>
}

// One tool the toolkit surfaces to the agent. `slug` is Composio's action id and
// becomes the tool key (so the pending-action executor can replay it by name).
export interface ComposioToolSpec {
  slug: string
  description: string
  parameters: z.ZodTypeAny
  // Builds the approval-card title/preview for a gated (write) action from its
  // args. Falls back to the slug + JSON args when omitted.
  preview?: (args: Record<string, unknown>) => {
    title: string
    preview: string
    confirmText?: string
  }
  // Names of string params that are actually file URLs. Composio's own schema
  // marks the underlying parameter `file_uploadable: true` — it wants a staged
  // `{name, mimetype, s3key}` descriptor, not a raw URL or path. Listed here,
  // the adapter stages each named arg via executor.stageFile() right before
  // execution (replay time, so short-lived asset URLs are still fresh) and
  // substitutes the descriptor in its place.
  fileParams?: string[]
  // Params the model has no reliable way to fill in itself — e.g. an Instagram
  // Business Account ID. Rather than let the model guess (it will, and guess
  // wrong), the adapter overwrites the named arg right before execution with
  // the `id` field from calling `viaSlug` (a no-arg lookup action) for the same
  // user. Same replay-time timing as fileParams, for the same reason.
  //
  // `list: true` is for accounts that can have more than one of the thing
  // (a Facebook user can manage several pages; a WhatsApp Business Account can
  // have several numbers) — viaSlug's result is treated as a collection and
  // only auto-fills when it has exactly one item. Guessing which of several is
  // wrong in a way that's worse than today's failure (it could silently act on
  // the wrong page/number instead of erroring), so 0 or 2+ items leaves the
  // model's original value untouched.
  resolvedParams?: Record<string, { viaSlug: string; list?: boolean }>
}

export interface ComposioCatalogParameter {
  type?: string
  description?: string
  required?: boolean
  enum?: unknown[]
  items?: ComposioCatalogParameter
  properties?: Record<string, ComposioCatalogParameter>
  additionalProperties?: boolean
  file_uploadable?: boolean
}

export interface ComposioCatalogTool {
  slug: string
  description?: string
  human_description?: string
  input_parameters?: Record<string, ComposioCatalogParameter>
}

function catalogParameterSchema(parameter: ComposioCatalogParameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny
  if (parameter.enum?.length) {
    const values = parameter.enum.filter((value): value is string => typeof value === "string")
    schema = values.length ? z.enum(values as [string, ...string[]]) : z.unknown()
  } else if (parameter.type === "array") {
    schema = z.array(catalogParameterSchema(parameter.items ?? { type: "string" }))
  } else if (parameter.type === "object" || parameter.properties) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, child] of Object.entries(parameter.properties ?? {})) {
      shape[key] = catalogParameterSchema(child)
    }
    schema = z.object(shape).passthrough()
  } else {
    schema =
      parameter.type === "number"
        ? z.number()
        : parameter.type === "integer"
          ? z.number().int()
          : parameter.type === "boolean"
            ? z.boolean()
            : parameter.type === "null"
              ? z.null()
              : z.string()
  }
  return parameter.description ? schema.describe(parameter.description) : schema
}

// Converts Composio's catalog metadata to the same guarded spec used by the
// hand-written connectors. Unknown catalog actions intentionally receive no
// special risk or file resolver metadata: the default classifier gates them.
export function composioCatalogToolToSpec(tool: ComposioCatalogTool): ComposioToolSpec {
  const shape: Record<string, z.ZodTypeAny> = {}
  const fileParams: string[] = []
  for (const [name, parameter] of Object.entries(tool.input_parameters ?? {})) {
    const schema = catalogParameterSchema(parameter)
    shape[name] = parameter.required === false ? schema.optional() : schema
    if (parameter.file_uploadable) fileParams.push(name)
  }
  return {
    slug: tool.slug,
    description: tool.description || tool.human_description || tool.slug,
    parameters: z.object(shape).passthrough(),
    ...(fileParams.length ? { fileParams } : {}),
  }
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

// Replaces each fileParams entry in `args` (a URL string the model provided)
// with its staged {name, mimetype, s3key} descriptor. No-ops a param that's
// missing, not a string, or already an object (already staged/replayed).
// Throws if the spec declares fileParams but the executor has no stageFile —
// that's a real misconfiguration (a native/test executor wired to a toolkit
// that needs staging), not something to silently skip.
async function stageFileParams(
  executor: ComposioExecutor,
  spec: ComposioToolSpec,
  toolkit: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!spec.fileParams?.length) return args
  if (!executor.stageFile) {
    throw new Error(`${spec.slug} needs file staging but the executor has no stageFile()`)
  }
  const staged = { ...args }
  for (const param of spec.fileParams) {
    const value = staged[param]
    if (typeof value !== "string" || !value) continue
    staged[param] = await executor.stageFile({
      url: value,
      toolSlug: spec.slug,
      toolkitSlug: toolkit,
    })
  }
  return staged
}

// Overwrites each resolvedParams entry in `args` with the real value looked up
// via its viaSlug action, discarding whatever the model supplied — the model
// has no ground truth for these (e.g. an Instagram Business Account ID) and
// guessing produces confusing provider-side errors instead of a clean failure.
// Leaves the arg untouched if the lookup errors or has no `id` field, so a
// resolver outage degrades to today's (broken) behavior rather than throwing.
// Unwraps a viaSlug lookup's result into a plain array, for `list: true`
// resolvedParams. Handles both a directly-returned array (e.g. WhatsApp's
// phone-numbers list) and Meta Graph API's nested pagination envelope
// (Facebook actions wrap the real payload as `{ response_data: { data: [...],
// paging: {...} } }`).
function extractList(result: unknown): unknown[] | null {
  if (Array.isArray(result)) return result
  if (result && typeof result === "object") {
    const responseData = (result as { response_data?: unknown }).response_data
    if (responseData && typeof responseData === "object") {
      const data = (responseData as { data?: unknown }).data
      if (Array.isArray(data)) return data
    }
  }
  return null
}

async function resolveDynamicParams(
  executor: ComposioExecutor,
  spec: ComposioToolSpec,
  userId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!spec.resolvedParams) return args
  const resolved = { ...args }
  for (const [param, { viaSlug, list }] of Object.entries(spec.resolvedParams)) {
    const result = await executor.execute({ userId, slug: viaSlug, arguments: {} })
    if (list) {
      const items = extractList(result)
      if (!items || items.length !== 1) continue
      const id = (items[0] as { id?: unknown } | null)?.id
      if (typeof id === "string" && id) resolved[param] = id
      continue
    }
    const id = (result as { id?: unknown } | null)?.id
    if (typeof id === "string" && id) resolved[param] = id
  }
  return resolved
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
              const staged = await stageFileParams(opts.executor, spec, opts.toolkit, args)
              const resolved = await resolveDynamicParams(opts.executor, spec, ctx.userId, staged)
              const result = await opts.executor.execute({
                userId: ctx.userId,
                slug: spec.slug,
                arguments: resolved,
              })
              return capComposioResult(enrichReadError(result))
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
              async () => {
                // Staged at replay time, not when the pending action is created —
                // an approval can sit for up to 30 minutes, and the source asset
                // URL (a short-lived presigned S3 link) needs to still be valid
                // when this actually runs.
                const staged = await stageFileParams(opts.executor, spec, opts.toolkit, args)
                const resolved = await resolveDynamicParams(opts.executor, spec, ctx.userId, staged)
                return capComposioResult(
                  await opts.executor.execute({
                    userId: ctx.userId,
                    slug: spec.slug,
                    arguments: resolved,
                  }),
                )
              },
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
