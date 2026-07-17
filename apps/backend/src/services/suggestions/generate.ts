import { and, desc, eq } from "drizzle-orm"
import { generateObject, jsonSchema } from "ai"
import { db, mcpConnections, memoryEntries, suggestionDecisions } from "@yomi/db"
import { createModel } from "@yomi/agent-core"
import { recordAiUsage } from "../ai-telemetry.js"
import { checkConsent } from "../privacy/checks.js"
import { earnedPatterns, type EarnedPattern } from "./earned-patterns.js"
import {
  assembleGeneratedSuggestions,
  type AssemblyContext,
  type ModelSuggestionSlot,
} from "./assemble.js"
import type { SuggestionEntry } from "./catalog.js"

// Fast model — sole job is phrasing already-earned patterns (ADR-0001). Cheap,
// structured, and never charged to the user (mirrors per-turn memory extraction).
function fastModel(): string {
  return process.env["OPENAI_FAST_MODEL"] || "gpt-5.4-mini"
}

// Cap the durable focuses handed to the model — topic enrichment only, not a memory dump.
const MAX_FOCUSES = 12

// The whole model response is untrusted; every field is re-validated by Seam 2. The
// schema only shapes the call — it never gates identity, connection, or scheduling.
interface ModelOutput {
  suggestions: ModelSuggestionSlot[]
}

const outputSchema = jsonSchema<ModelOutput>({
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["connector", "timeBucket", "title", "description", "schedule", "prompt", "deliverTo"],
        properties: {
          connector: { type: "string" },
          timeBucket: { type: "string", enum: ["morning", "afternoon", "evening"] },
          title: { type: "string" },
          description: { type: "string" },
          schedule: { type: "string" },
          prompt: { type: "string" },
          deliverTo: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
})

const PHRASING_SYSTEM = [
  "You phrase proactive automation suggestions for Yomi. You are given behavioral",
  "patterns the user has ALREADY earned — each is a (connector, timeBucket) the user",
  "genuinely uses. Produce exactly one suggestion per pattern, echoing its connector",
  "and timeBucket verbatim. Never invent connectors or patterns not in the list.",
  "",
  "For each pattern emit: a short title; a one-sentence description; a schedule string",
  'in Yomi phrase syntax (e.g. "every day 9am", "every monday 8am") aligned to the',
  "timeBucket (morning ~8-9am, afternoon ~1-2pm, evening ~6-7pm); a concrete agent",
  'prompt; and deliverTo ["telegram"]. Use the provided focus topics only to make the',
  "title and description specific — they never change which patterns you suggest.",
].join("\n")

function buildUserPrompt(patterns: EarnedPattern[], focuses: string[]): string {
  const patternLines = patterns
    .map((p) => `- connector=${p.connector} timeBucket=${p.timeBucket}`)
    .join("\n")
  const focusBlock = focuses.length
    ? `\n\nUser focus topics (for wording only):\n${focuses.map((f) => `- ${f}`).join("\n")}`
    : ""
  return `Earned patterns:\n${patternLines}${focusBlock}`
}

// Durable focuses for topic enrichment. Read ONLY when memory/cloud_memory consent
// is present; the caller degrades to [] otherwise (same path as cold-start).
async function loadDurableFocuses(userId: string): Promise<string[]> {
  const rows = await db
    .select({ topic: memoryEntries.topic, summary: memoryEntries.summary })
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.userId, userId),
        eq(memoryEntries.status, "active"),
        eq(memoryEntries.isLatest, true),
      ),
    )
    .orderBy(
      desc(memoryEntries.isStatic),
      desc(memoryEntries.confidence),
      desc(memoryEntries.updatedAt),
    )
    .limit(MAX_FOCUSES)
  return rows.map((r) => (r.summary ? `${r.topic}: ${r.summary}` : r.topic)).filter(Boolean)
}

// Everything Seam 2 needs that lives in the DB. existingSchedules is empty for v1:
// hand-rolled schedules carry no connector, so that guard relies on the decision
// latch (ADR-0001 accepts best-effort dedup / occasional near-duplicate offers).
async function loadAssemblyContext(userId: string): Promise<AssemblyContext> {
  const [connRows, decidedRows] = await Promise.all([
    db
      .select({ provider: mcpConnections.provider })
      .from(mcpConnections)
      .where(eq(mcpConnections.userId, userId)),
    db
      .select({ dedupKey: suggestionDecisions.dedupKey })
      .from(suggestionDecisions)
      .where(eq(suggestionDecisions.userId, userId)),
  ])
  return {
    connectedConnectors: connRows.map((r) => r.provider),
    latchedKeys: decidedRows.map((r) => r.dedupKey),
    existingSchedules: [],
  }
}

// Per-user generation orchestrator (ADR-0001). Ties the deterministic evidence gate
// (Seam 1) to the phrasing-only model call and the structural assembler (Seam 2),
// honors memory consent by degrading, and records cost without ever charging it.
export async function generateSuggestions(
  userId: string,
  now: Date = new Date(),
): Promise<SuggestionEntry[]> {
  const patterns = await earnedPatterns(userId, now)
  if (patterns.length === 0) return [] // nothing earned — no model call, ADR-0001

  // Topic enrichment is consent-gated: memory content is read only with explicit
  // memory OR cloud_memory grant. Absent consent degrades to telemetry-only phrasing.
  const [memoryConsent, cloudMemoryConsent] = await Promise.all([
    checkConsent(userId, "memory"),
    checkConsent(userId, "cloud_memory"),
  ])
  const focuses =
    memoryConsent.allowed || cloudMemoryConsent.allowed ? await loadDurableFocuses(userId) : []

  const model = fastModel()
  const startedAt = Date.now()
  // Shared across both outcomes; creditsCharged is always 0 — the earning is
  // code-side and free, so generation is never billed to the user (ADR-0001).
  const baseUsage = {
    userId,
    endpoint: "backend.suggestions.generate",
    surface: "backend",
    route: "suggestions",
    model,
    connectorIds: [...new Set(patterns.map((p) => p.connector))],
    creditsCharged: 0,
  }
  let slots: ModelSuggestionSlot[] = []
  try {
    const { object, usage } = await generateObject({
      model: createModel(model),
      schema: outputSchema,
      system: PHRASING_SYSTEM,
      prompt: buildUserPrompt(patterns, focuses),
    })
    slots = Array.isArray(object?.suggestions) ? object.suggestions : []
    recordAiUsage({
      ...baseUsage,
      requestId: crypto.randomUUID(),
      inputTokens: usage?.promptTokens,
      outputTokens: usage?.completionTokens,
      latencyMs: Date.now() - startedAt,
      status: "done",
    }).catch(() => {}) // best-effort — telemetry must never break generation
  } catch (err) {
    recordAiUsage({
      ...baseUsage,
      requestId: crypto.randomUUID(),
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: err instanceof Error ? err.message.slice(0, 120) : "generate_failed",
    }).catch(() => {}) // best-effort
    return []
  }

  const context = await loadAssemblyContext(userId)
  return assembleGeneratedSuggestions(patterns, context, slots)
}
