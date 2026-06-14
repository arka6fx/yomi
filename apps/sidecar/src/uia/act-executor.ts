// Validation-First Execution — Plan → Execute → Validate → Recover → Continue.
// Every UIA action goes through this pipeline. Hermes applyHooks integration.
// Uses: recovery.ts (recovery ladder) + procedural-memory.ts (strategy learning).

import { uia } from "./client.js"
import { hooks, toolGuardrail } from "../harness/hooks.js"
import { executeWithRecovery, type RecoveryContext } from "./recovery.js"
import { rememberStrategy, recordFailure, recordDuration, recallBestStrategy } from "./procedural-memory.js"
import type { UiaElement } from "@yomi/shared"

// ===========================================================================
// Types
// ===========================================================================

export interface ActionPlan {
  app: string
  goal: string
  toolName: string
  toolParams: Record<string, unknown>
  recoveryContext?: RecoveryContext
  validateFn: (result: unknown) => Promise<boolean>
  timeoutMs?: number
}

export interface ActionResult {
  ok: boolean
  result?: unknown
  recovery?: { recovered: boolean; strategy: string }
  strategy?: string
  durationMs: number
}

// ===========================================================================
// Core pipeline
// ===========================================================================

export async function executePlan(plan: ActionPlan): Promise<ActionResult> {
  const start = Date.now()
  toolGuardrail.resetForTurn() // Hermes: fresh guardrail state per action

  // --- PLAN ---
  // Check if we have a proven strategy for this app+goal
  const known = await recallBestStrategy(plan.app, plan.goal)
  if (known && known.confidence >= 0.7) {
    console.warn(`[executor] using known strategy for ${plan.app}/${plan.goal}: ${known.method} (confidence: ${(known.confidence * 100).toFixed(0)}%)`)
  }

  // --- EXECUTE ---
  const preResult = await hooks.onPreToolUse(plan.toolName, plan.toolParams)
  if (!preResult.ok) {
    return { ok: false, result: { error: preResult.reason }, durationMs: Date.now() - start }
  }

  let result: unknown
  try {
    result = await uia.call(plan.toolName, plan.toolParams, plan.timeoutMs ?? 10_000)
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) }
  }

  // Post-hooks
  result = await hooks.onPostToolUse(plan.toolName, result, plan.toolParams)

  // --- VALIDATE ---
  let valid = false
  try {
    valid = await plan.validateFn(result)
  } catch (e) {
    console.warn(`[executor] validation threw: ${e instanceof Error ? e.message : String(e)}`)
  }

  // --- RECOVER --- (if validation fails)
  if (!valid && plan.recoveryContext) {
    console.warn(`[executor] validation failed — starting recovery ladder for ${plan.app}/${plan.goal}`)
    const recovered = await executeWithRecovery(
      async (ref) => {
        const params = { ...plan.toolParams, ref }
        const r = await uia.call(plan.toolName, params, plan.timeoutMs ?? 10_000).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
        return r as { ok?: boolean; error?: string }
      },
      plan.recoveryContext,
    )

    if (recovered.ok) {
      valid = true
      result = { ...(result as object), recovered: true }
    }

    const duration = Date.now() - start
    await recordFailure(plan.app, plan.goal, plan.toolName)
    return { ok: valid, result, recovery: { recovered: recovered.ok, strategy: recovered.recovery?.strategy ?? "unknown" }, durationMs: duration }
  }

  // --- LEARN ---
  const duration = Date.now() - start
  if (valid) {
    await rememberStrategy({
      app: plan.app,
      goal: plan.goal,
      method: plan.toolName,
      confidence: 0.7,
    })
    await recordDuration(plan.app, plan.goal, plan.toolName, duration)
  } else {
    await recordFailure(plan.app, plan.goal, plan.toolName)
  }

  return { ok: valid, result, strategy: known?.method, durationMs: duration }
}

// ===========================================================================
// Pre-built validation functions
// ===========================================================================

export function validateWindowExists(hwnd: number) {
  return async () => {
    const info = await uia.getWindowInfo({ hwnd }).catch(() => null)
    return !!info?.window && info.window.length > 0
  }
}

export function validateElementValue(ref: string, expected: string) {
  return async () => {
    const el = uia.getElement(ref)
    return el?.value === expected
  }
}

export function validateElementEnabled(ref: string) {
  return async () => {
    const el = uia.getElement(ref)
    return el?.enabled === true
  }
}

export function validateFileExists(path: string) {
  return async () => {
    const { existsSync } = await import("node:fs")
    return existsSync(path)
  }
}

// ===========================================================================
// Semantic intent classifier (basic — no ML, pattern-based)
// ===========================================================================

interface SemanticIntent {
  intent: "send" | "search" | "close" | "navigate" | "confirm" | "cancel" | "upload" | "download" | "play" | "pause" | "unknown"
  confidence: number
}

export function classifyIntent(role: string, name: string): SemanticIntent {
  const n = name.toLowerCase()
  const r = role.toLowerCase()

  if (/\b(send|submit|post)\b/i.test(n)) return { intent: "send", confidence: 0.9 }
  if (/\b(search|find|look)\b/i.test(n) || (r === "edit" && /search/i.test(n))) return { intent: "search", confidence: 0.9 }
  if (/\b(close|dismiss|exit|quit)\b/i.test(n)) return { intent: "close", confidence: 0.9 }
  if (/\b(back|home|go|navigate|next|previous|forward)\b/i.test(n)) return { intent: "navigate", confidence: 0.85 }
  if (/\b(ok|yes|confirm|accept|agree|save)\b/i.test(n)) return { intent: "confirm", confidence: 0.85 }
  if (/\b(cancel|no|decline|reject|abort)\b/i.test(n)) return { intent: "cancel", confidence: 0.85 }
  if (/\b(upload|attach|add file|choose file)\b/i.test(n)) return { intent: "upload", confidence: 0.85 }
  if (/\b(download|save as|export)\b/i.test(n)) return { intent: "download", confidence: 0.85 }
  if (/\b(play|resume|start)\b/i.test(n)) return { intent: "play", confidence: 0.85 }
  if (/\b(pause|stop|halt)\b/i.test(n)) return { intent: "pause", confidence: 0.85 }

  return { intent: "unknown", confidence: 0.3 }
}

// Classify a full UIA element into a semantic representation
export function semanticDescribe(el: UiaElement): { role: string; intent: SemanticIntent; name: string } {
  return {
    role: el.role,
    intent: classifyIntent(el.role, el.name),
    name: el.name,
  }
}
