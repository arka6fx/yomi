import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js"
import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import { createHash } from "node:crypto"
import { db, memoryEmbeddings, memoryEntries, schedules } from "@yomi/db"
import { checkConsent } from "./privacy/checks.js"
import { createPendingAction, type PendingActionRisk } from "./pending-actions.js"
import { getAccessToken, listConnectedProviders } from "./integration-tokens.js"
import { ConnectorRegistry } from "@yomi/agent-core"

interface McpToolContext {
  userId: string
  createPendingAction: (input: {
    connector: string
    action: string
    risk: PendingActionRisk
    title: string
    preview: string
    payload: unknown
  }) => Promise<{ id: string; status: string; message: string }>
}

interface McpSession {
  transport: StreamableHTTPServerTransport
  userId: string
  createdAt: number
  ctx: McpToolContext
}

const sessions = new Map<string, McpSession>()

const SESSION_TTL_MS = 30 * 60 * 1000
const EMBEDDING_DIMENSIONS = 1536
const MEMORY_CANDIDATES = Math.max(
  5,
  Number.parseInt(process.env["MEMORY_CANDIDATES"] ?? "30", 10) || 30,
)
const MEMORY_RRF_K = Math.max(1, Number.parseInt(process.env["MEMORY_RRF_K"] ?? "60", 10) || 60)

function reapStaleSessions(): void {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      s.transport.close().catch(() => {})
      sessions.delete(id)
    }
  }
}

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`
}

async function embedText(input: string): Promise<number[]> {
  if (!input.trim()) return []
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey) return []
  const baseUrl = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/+$/, "")
  const model = process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small"
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  })
  if (!res.ok) return []
  const body = (await res.json()) as { data?: { embedding?: number[] }[] }
  const embedding = body.data?.[0]?.embedding
  return Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSIONS ? embedding : []
}

async function handleMemorySearch(
  userId: string,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const consent = await checkConsent(userId, "memory")
  if (!consent.allowed) {
    return { content: [{ type: "text", text: `Memory consent denied: ${consent.reason}` }] }
  }

  const query = clean(args?.query, 400)
  const limit = clampLimit(args?.limit, 8, 25)
  const maxChars = clampLimit(args?.maxChars, 4000, 20_000)

  type MemorySearchRow = typeof memoryEntries.$inferSelect & {
    score?: number
    matchedBy?: string[]
  }
  let rows: MemorySearchRow[] = []

  if (!query) {
    rows = (await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userId),
          eq(memoryEntries.status, "active"),
          eq(memoryEntries.isLatest, true),
        ),
      )
      .orderBy(desc(memoryEntries.isStatic), desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
      .limit(limit)) as MemorySearchRow[]
  } else {
    const queryEmbedding = await embedText(query).catch(() => [])
    const vecSql = queryEmbedding.length
      ? sql`
        vec as (
          select me.memory_id, row_number() over (order by me.embedding <=> ${vectorLiteral(queryEmbedding)}::vector) as rnk
          from memory_embeddings me
          where me.user_id = ${userId}
          order by me.embedding <=> ${vectorLiteral(queryEmbedding)}::vector
          limit ${MEMORY_CANDIDATES}
        ),`
      : sql`
        vec as (
          select null::uuid as memory_id, null::bigint as rnk
          where false
        ),`

    const result = await db.execute(sql`
      with ${vecSql}
      fts as (
        select e.id as memory_id,
               row_number() over (order by ts_rank_cd(e.content_tsv, websearch_to_tsquery('english', ${query})) desc) as rnk
        from memory_entries e
        where e.user_id = ${userId}
          and e.status = 'active'
          and e.is_latest = true
          and e.content_tsv @@ websearch_to_tsquery('english', ${query})
        limit ${MEMORY_CANDIDATES}
      ),
      meta as (
        select e.id as memory_id,
               row_number() over (order by e.is_static desc, e.confidence desc, e.updated_at desc) as rnk
        from memory_entries e
        where e.user_id = ${userId}
          and e.status = 'active'
          and e.is_latest = true
          and (
            e.topic ilike ${`%${query}%`} or
            e.summary ilike ${`%${query}%`} or
            e.content ilike ${`%${query}%`} or
            e.kind ilike ${`%${query}%`} or
            e.scope ilike ${`%${query}%`} or
            e.source_path ilike ${`%${query}%`}
          )
        limit ${MEMORY_CANDIDATES}
      ),
      fused as (
        select memory_id,
               sum(1.0 / (${MEMORY_RRF_K} + rnk)) as score,
               array_agg(source) as matched_by
        from (
          select memory_id, rnk, 'vector'::text as source from vec where memory_id is not null
          union all
          select memory_id, rnk, 'full_text'::text as source from fts
          union all
          select memory_id, rnk, 'metadata'::text as source from meta
        ) u
        group by memory_id
        order by score desc
        limit ${MEMORY_CANDIDATES}
      )
      select
        e.id as "id",
        e.user_id as "userId",
        e.custom_id as "customId",
        e.content_hash as "contentHash",
        e.kind as "kind",
        e.scope as "scope",
        e.topic as "topic",
        e.summary as "summary",
        e.content as "content",
        e.status as "status",
        e.confidence as "confidence",
        e.source_type as "sourceType",
        e.source_path as "sourcePath",
        e.version as "version",
        e.is_latest as "isLatest",
        e.is_static as "isStatic",
        e.root_memory_id as "rootMemoryId",
        e.parent_memory_id as "parentMemoryId",
        e.forget_after as "forgetAfter",
        e.metadata as "metadata",
        e.created_at as "createdAt",
        e.updated_at as "updatedAt",
        f.score as "score",
        f.matched_by as "matchedBy"
      from fused f
      join memory_entries e on e.id = f.memory_id
      order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
      limit ${limit}
    `)
    rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as MemorySearchRow[]
  }

  const memoryLines: string[] = []
  let used = 0
  for (const row of rows) {
    const serialized = `${row.kind}: ${row.topic}\n${row.summary ? `${row.summary}\n` : ""}${row.content}`
    if (used + serialized.length > maxChars) break
    memoryLines.push(
      `[${row.kind}] ${row.topic}${row.score != null ? ` (score: ${row.score.toFixed(4)})` : ""}${row.matchedBy ? ` [${row.matchedBy.join(", ")}]` : ""}
  ${row.summary ? `${row.summary}\n  ` : ""}${row.content}`,
    )
    used += serialized.length
  }

  return {
    content: [
      {
        type: "text",
        text: memoryLines.length > 0 ? memoryLines.join("\n---\n") : "No memories found.",
      },
    ],
  }
}

async function handleMemoryGetProfile(
  userId: string,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const consent = await checkConsent(userId, "memory")
  if (!consent.allowed) {
    return { content: [{ type: "text", text: `Memory consent denied: ${consent.reason}` }] }
  }

  const query = clean(args?.query, 400)
  const limit = clampLimit(args?.limit, 24, 80)

  const baseWhere = and(
    eq(memoryEntries.userId, userId),
    eq(memoryEntries.status, "active"),
    eq(memoryEntries.isLatest, true),
  )
  const [staticRows, dynamicRows] = await Promise.all([
    db
      .select()
      .from(memoryEntries)
      .where(and(baseWhere, eq(memoryEntries.isStatic, true)))
      .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
      .limit(limit),
    db
      .select()
      .from(memoryEntries)
      .where(and(baseWhere, eq(memoryEntries.isStatic, false)))
      .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
      .limit(limit),
  ])

  const relevant = query
    ? await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            baseWhere,
            or(
              ilike(memoryEntries.topic, `%${query}%`),
              ilike(memoryEntries.content, `%${query}%`),
              ilike(memoryEntries.summary, `%${query}%`),
            ),
          ),
        )
        .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
        .limit(Math.min(limit, 12))
    : []

  const parts: string[] = []
  if (staticRows.length > 0) {
    parts.push("=== Static Profile ===")
    for (const r of staticRows) parts.push(`- ${r.summary || r.content}`)
  }
  if (dynamicRows.length > 0) {
    parts.push("=== Dynamic Profile ===")
    for (const r of dynamicRows) parts.push(`- ${r.summary || r.content}`)
  }
  if (relevant.length > 0) {
    parts.push("=== Relevant Memories ===")
    for (const r of relevant) parts.push(`- [${r.kind}] ${r.topic}: ${r.summary || r.content}`)
  }

  return {
    content: [
      {
        type: "text",
        text: parts.length > 0 ? parts.join("\n") : "No profile memories found.",
      },
    ],
  }
}

async function handleMemoryAdd(
  ctx: McpToolContext,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const consent = await checkConsent(ctx.userId, "memory")
  if (!consent.allowed) {
    return { content: [{ type: "text", text: `Memory consent denied: ${consent.reason}` }] }
  }

  const content = clean(args?.content ?? "", 8000)
  const kind = clean(args?.kind ?? "fact", 40)
  const scope = clean(args?.scope ?? "global", 80)
  const topic = clean(args?.topic ?? "", 160)
  const summary = args?.summary !== undefined ? clean(args.summary, 500) : undefined
  const confidence = typeof args?.confidence === "number" ? Math.max(0, Math.min(100, args.confidence)) : 70
  const isStatic = args?.isStatic === true
  const customId = args?.customId !== undefined ? clean(args.customId, 200) : undefined

  if (!content || !topic) {
    return { content: [{ type: "text", text: "Both 'content' and 'topic' are required." }] }
  }

  const payload = { content, kind: kind || "fact", scope: scope || "global", topic, summary, confidence, isStatic, customId }

  const result = await ctx.createPendingAction({
    connector: "memory",
    action: "memory_add",
    risk: "write",
    title: "Add a memory entry",
    preview: `Kind: ${kind}\nScope: ${scope}\nTopic: ${topic}\nContent: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`,
    payload,
  })

  return {
    content: [
      {
        type: "text",
        text: result.message,
      },
    ],
  }
}

async function handleMemoryForget(
  ctx: McpToolContext,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const consent = await checkConsent(ctx.userId, "memory")
  if (!consent.allowed) {
    return { content: [{ type: "text", text: `Memory consent denied: ${consent.reason}` }] }
  }

  const id = args?.id !== undefined ? clean(args.id, 80) : undefined
  const customId = args?.customId !== undefined ? clean(args.customId, 200) : undefined
  const query = clean(args?.query ?? "", 400)
  const hard = args?.hard === true

  if (!id && !customId && !query) {
    return {
      content: [
        {
          type: "text",
          text: "Either 'id', 'customId', or 'query' is required.",
        },
      ],
    }
  }

  const target = id || customId || query

  const result = await ctx.createPendingAction({
    connector: "memory",
    action: "memory_forget",
    risk: "write",
    title: "Forget a memory entry",
    preview: `Target: ${target}${hard ? " (hard delete)" : " (soft delete)"}`,
    payload: { id, customId, query, hard },
  })

  return {
    content: [
      {
        type: "text",
        text: result.message,
      },
    ],
  }
}

async function handleScheduleList(
  userId: string,
  _args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.userId, userId))
    .orderBy(desc(schedules.createdAt))
    .limit(100)

  if (rows.length === 0) {
    return { content: [{ type: "text", text: "No schedules found." }] }
  }

  const lines = rows.map(
    (s) =>
      `- ID: ${s.id}\n  Schedule: ${s.schedule}\n  Prompt: ${s.prompt}\n  Enabled: ${s.enabled}\n  Next run: ${s.nextRunAt?.toISOString() ?? "never"}`,
  )

  return { content: [{ type: "text", text: lines.join("\n---\n") }] }
}

async function handleScheduleCreate(
  ctx: McpToolContext,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const schedule = clean(args?.schedule ?? "", 500)
  const prompt = clean(args?.prompt ?? "", 5000)
  const deliverTo = args?.deliverTo

  if (!schedule) {
    return { content: [{ type: "text", text: "Schedule is required." }] }
  }
  if (!prompt) {
    return { content: [{ type: "text", text: "Prompt is required." }] }
  }

  const result = await ctx.createPendingAction({
    connector: "schedule",
    action: "schedule_create",
    risk: "write",
    title: "Create a schedule",
    preview: `Schedule: ${schedule}\nPrompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`,
    payload: { schedule, prompt, deliverTo: Array.isArray(deliverTo) ? deliverTo : ["telegram"] },
  })

  return {
    content: [
      {
        type: "text",
        text: result.message,
      },
    ],
  }
}

async function handleScheduleDelete(
  ctx: McpToolContext,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const id = args?.id !== undefined ? clean(args.id, 80) : undefined

  if (!id) {
    return { content: [{ type: "text", text: "Schedule ID is required." }] }
  }

  const result = await ctx.createPendingAction({
    connector: "schedule",
    action: "schedule_delete",
    risk: "write",
    title: "Delete a schedule",
    preview: `Schedule ID: ${id}`,
    payload: { id },
  })

  return {
    content: [
      {
        type: "text",
        text: result.message,
      },
    ],
  }
}

async function handleExecuteConnectorTool(
  ctx: McpToolContext,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const connector = clean(args?.connector ?? "", 80)
  const action = clean(args?.action ?? "", 80)
  const toolArgs = args?.arguments as Record<string, unknown> | undefined

  if (!connector) {
    return { content: [{ type: "text", text: "Connector name is required." }] }
  }
  if (!action) {
    return { content: [{ type: "text", text: "Action name is required." }] }
  }

  const connectedProviders = await listConnectedProviders(ctx.userId)
  if (!connectedProviders.includes(connector)) {
    return {
      content: [
        {
          type: "text",
          text: `Connector "${connector}" is not connected. Connect it first at https://getyomi.in/dashboard`,
        },
      ],
    }
  }

  const registry = new ConnectorRegistry({
    excludeNodeOnly: true,
    getAccessToken,
    createPendingAction: async (input) => {
      return ctx.createPendingAction({
        ...input,
      })
    },
    listConnectedProviders,
  })
  await registry.init(ctx.userId)

  const allTools = registry.getAllDefTools()
  const tool = Object.values(allTools).flatMap((t) => Object.values(t)).find((t) => t.name === action)

  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: `Action "${action}" not found in connector "${connector}".`,
        },
      ],
    }
  }

  const result = await tool.execute(toolArgs ?? {}, { toolCallId: action, messages: [] })

  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>
    if (record.error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${record.error}`,
          },
        ],
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  }

  return {
    content: [
      {
        type: "text",
        text: String(result ?? "No result"),
      },
    ],
  }
}

function createServer(ctx: McpToolContext): Server {
  const server = new Server(
    { name: "yomi", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "memory_search",
        description: "Search the user's memory using hybrid vector+FTS+metadata search. Returns ranked memory entries.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (empty returns recent memories)" },
            limit: { type: "number", description: "Max results (1-25, default 8)" },
            maxChars: { type: "number", description: "Max total characters (100-20000, default 4000)" },
          },
        },
      },
      {
        name: "memory_get_profile",
        description: "Fetch the user's static and dynamic profile memories.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional filter query for relevant memories" },
            limit: { type: "number", description: "Max results per section (1-80, default 24)" },
          },
        },
      },
      {
        name: "memory_add",
        description: "Create or update a memory entry. Requires approval before execution.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The memory content (required)" },
            kind: { type: "string", description: "Category: fact, preference, project, decision, etc. (default: fact)" },
            scope: { type: "string", description: "Scope: global, project, app, session (default: global)" },
            topic: { type: "string", description: "Topic/key for the memory (required)" },
            summary: { type: "string", description: "Brief summary or title" },
            confidence: { type: "number", description: "Confidence 0-100 (default: 70)" },
            isStatic: { type: "boolean", description: "Whether this is a static profile memory" },
            customId: { type: "string", description: "Custom ID for deduplication" },
          },
          required: ["content", "topic"],
        },
      },
      {
        name: "memory_forget",
        description: "Delete a memory entry. Requires approval before execution.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Memory ID to forget (mutually exclusive with customId/query)" },
            customId: { type: "string", description: "Custom ID to forget (mutually exclusive with id/query)" },
            query: { type: "string", description: "Search query to find memories to forget (mutually exclusive with id/customId)" },
            hard: { type: "boolean", description: "Hard delete instead of soft delete" },
          },
        },
      },
      {
        name: "schedule_list",
        description: "List the user's scheduled jobs. Read-only.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "schedule_create",
        description: "Create a new schedule. Requires approval before execution.",
        inputSchema: {
          type: "object",
          properties: {
            schedule: { type: "string", description: "Schedule spec (e.g., 'every day 9am', 'every Monday 10am')" },
            prompt: { type: "string", description: "The prompt/action to run on schedule" },
            deliverTo: {
              type: "array",
              items: { type: "string" },
              description: "Delivery targets (e.g., ['telegram'])",
            },
          },
          required: ["schedule", "prompt"],
        },
      },
      {
        name: "schedule_delete",
        description: "Delete a schedule. Requires approval before execution.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Schedule ID to delete" },
          },
          required: ["id"],
        },
      },
      {
        name: "execute_connector_tool",
        description: "Execute a tool from a connected connector. Read tools execute directly; write/send/paid/irreversible tools require approval.",
        inputSchema: {
          type: "object",
          properties: {
            connector: { type: "string", description: "Connector name (e.g., 'gmail', 'google-calendar')" },
            action: { type: "string", description: "Tool/action name to execute" },
            arguments: {
              type: "object",
              description: "Arguments for the tool",
            },
          },
          required: ["connector", "action"],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    switch (name) {
      case "memory_search":
        return handleMemorySearch(ctx.userId, (args ?? {}) as Record<string, unknown>)
      case "memory_get_profile":
        return handleMemoryGetProfile(ctx.userId, (args ?? {}) as Record<string, unknown>)
      case "memory_add":
        return handleMemoryAdd(ctx, (args ?? {}) as Record<string, unknown>)
      case "memory_forget":
        return handleMemoryForget(ctx, (args ?? {}) as Record<string, unknown>)
      case "schedule_list":
        return handleScheduleList(ctx.userId, (args ?? {}) as Record<string, unknown>)
      case "schedule_create":
        return handleScheduleCreate(ctx, (args ?? {}) as Record<string, unknown>)
      case "schedule_delete":
        return handleScheduleDelete(ctx, (args ?? {}) as Record<string, unknown>)
      case "execute_connector_tool":
        return handleExecuteConnectorTool(ctx, (args ?? {}) as Record<string, unknown>)
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }
  })

  return server
}

export async function handleMcpPost(
  body: string | null,
  mcpSessionId: string | null,
  userId: string,
  createPendingActionFn: (input: {
    connector: string
    action: string
    risk: PendingActionRisk
    title: string
    preview: string
    payload: unknown
  }) => Promise<{ id: string; status: string; message: string }>,
): Promise<Response> {
  reapStaleSessions()

  let session = mcpSessionId ? sessions.get(mcpSessionId) : undefined

  if (!session) {
    const ctx: McpToolContext = { userId, createPendingAction: createPendingActionFn }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })
    const server = createServer(ctx)
    await server.connect(transport)
    session = { transport, userId, createdAt: Date.now(), ctx }

    transport.onclose = () => {
      if (mcpSessionId) sessions.delete(mcpSessionId)
    }
  }

  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(mcpSessionId ? { "MCP-Session-Id": mcpSessionId } : {}),
    },
    body,
  })

  const wt = (session.transport as unknown as { _webStandardTransport: { handleRequest: (req: Request) => Promise<Response> } })._webStandardTransport
  const response = await wt.handleRequest(req)

  const newSessionId = response.headers.get("mcp-session-id")
  if (newSessionId && newSessionId !== mcpSessionId) {
    sessions.set(newSessionId, session)
  }

  return response
}

export async function handleMcpGet(
  mcpSessionId: string,
  _userId: string,
): Promise<Response> {
  const session = sessions.get(mcpSessionId)
  if (!session) return new Response("Session not found", { status: 404 })

  const req = new Request("http://localhost/mcp", {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "MCP-Session-Id": mcpSessionId,
    },
  })

  const wt = (session.transport as unknown as { _webStandardTransport: { handleRequest: (req: Request) => Promise<Response> } })._webStandardTransport
  return wt.handleRequest(req)
}

export async function handleMcpDelete(mcpSessionId: string): Promise<Response> {
  const session = sessions.get(mcpSessionId)
  if (!session) return new Response("Session not found", { status: 404 })

  const req = new Request("http://localhost/mcp", {
    method: "DELETE",
    headers: {
      "MCP-Session-Id": mcpSessionId,
    },
  })

  const wt = (session.transport as unknown as { _webStandardTransport: { handleRequest: (req: Request) => Promise<Response> } })._webStandardTransport
  const response = await wt.handleRequest(req)
  sessions.delete(mcpSessionId)
  return response
}

export async function getMcpSessionUserId(sessionId: string): Promise<string | null> {
  return sessions.get(sessionId)?.userId ?? null
}
