// Recovery Engine v2 — multi-strategy recovery ladder for UIA actions.
// Spec: reResolve → reFocus → reScan → rePlan → fail only when all exhausted.
// Integrates with Hermes guardrails and LangGraph validation.

import { uia, matchElement } from "./client.js"
import type { UiaElement } from "@yomi/shared"
import { createHash } from "node:crypto"

const DEFAULT_RETRIES = 3
const RECOVERY_DELAY_MS = 500

export function deterministicTaskId(scope: string, input: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify({ scope, input })).digest("hex").slice(0, 16)
  return `${scope.replace(/[^a-z0-9_-]+/gi, "-")}-${digest}`
}

export async function withAutomationHeartbeat<T>(
  work: (beat: () => void) => Promise<T>,
  options: { idleTimeoutMs?: number; onHeartbeat?: () => void } = {},
): Promise<T> {
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000
  let lastBeat = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  const beat = () => {
    lastBeat = Date.now()
    options.onHeartbeat?.()
  }
  const watchdog = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (Date.now() - lastBeat > idleTimeoutMs) {
        if (timer) clearInterval(timer)
        reject(new Error(`automation node idle timeout after ${idleTimeoutMs}ms`))
      }
    }, Math.min(1_000, Math.max(50, idleTimeoutMs / 2)))
  })
  try {
    return await Promise.race([work(beat), watchdog])
  } finally {
    if (timer) clearInterval(timer)
  }
}

export interface RecoveryResult {
  recovered: boolean
  strategy: string
  newRef?: string
  element?: UiaElement
}

// ===========================================================================
// Strategy 1: reResolve — fresh snapshot, match by automationId → name+role → fuzzy
// ===========================================================================

async function tryReResolve(staleRef: string): Promise<RecoveryResult> {
  const prev = uia.getElement(staleRef)
  if (!prev) return { recovered: false, strategy: "reResolve: no cached element" }

  const snap = await uia.getUiTree().catch(() => null)
  if (!snap?.elements) return { recovered: false, strategy: "reResolve: snapshot failed" }

  const match = matchElement(prev, snap.elements)
  if (match) {
    return { recovered: true, strategy: "reResolve", newRef: match.ref, element: match }
  }
  return { recovered: false, strategy: "reResolve: no match" }
}

// ===========================================================================
// Strategy 2: reFocus — ensure window is foreground, retry
// ===========================================================================

async function tryReFocus(hwnd: number | null): Promise<RecoveryResult> {
  if (!hwnd) {
    // Try to re-find the window by process name or title
    const fg = await uia.getForeground().catch(() => null)
    if (fg) {
      await uia.setForeground(fg).catch(() => {})
      return { recovered: true, strategy: "reFocus: foreground restored" }
    }
    return { recovered: false, strategy: "reFocus: no window handle" }
  }

  // Set foreground + maximize
  await uia.setForeground(hwnd).catch(() => {})
  await uia.maximizeWindow(hwnd).catch(() => {})
  await new Promise((r) => setTimeout(r, 600))

  // Verify window is now foreground
  const fg = await uia.getForeground().catch(() => null)
  if (fg === hwnd) return { recovered: true, strategy: "reFocus: window foregrounded" }

  return { recovered: false, strategy: "reFocus: window not responding" }
}

// ===========================================================================
// Strategy 3: reScan — full tree scan for element by role + name pattern
// ===========================================================================

async function tryReScan(
  role: string,
  namePattern: string,
  hwnd?: number,
): Promise<RecoveryResult> {
  const snap = await uia.getUiTree({ maxNodes: 500, maxDepth: 50, hwnd, lite: true }).catch(() => null)
  if (!snap) return { recovered: false, strategy: "reScan: snapshot failed" }

  // Find by role + name substring (case-insensitive)
  const needle = namePattern.toLowerCase()
  const matches = snap.elements.filter(
    (e) => e.enabled && !e.offscreen && e.role === role && e.name?.toLowerCase().includes(needle),
  )

  if (matches.length > 0) {
    // Prefer the largest match (most likely the correct target)
    const best = matches.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]
    if (!best) return { recovered: false, strategy: "reScan: no match after sort" }
    return { recovered: true, strategy: `reScan: found ${matches.length} match(es)`, newRef: best.ref, element: best }
  }

  // Try broader search: any role, same name pattern
  const broadMatches = snap.elements.filter(
    (e) => e.enabled && !e.offscreen && e.name && e.name.toLowerCase().includes(needle),
  )
  if (broadMatches.length > 0) {
    const best = broadMatches.sort((a, b) => (b.role === role ? 1 : 0) - (a.role === role ? 1 : 0) || b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]
    if (!best) return { recovered: false, strategy: "reScan: no broad match after sort" }
    return { recovered: true, strategy: `reScan: broad match (role=${best.role})`, newRef: best.ref, element: best }
  }

  return { recovered: false, strategy: "reScan: no matches" }
}

// ===========================================================================
// Strategy 4: rePlan — try alternative approaches (keyboard, coordinates)
// ===========================================================================

interface RePlanOptions {
  keyboardFallback?: string // e.g. "Ctrl+S", "Enter"
  coordinateFallback?: { x: number; y: number }
}

async function tryRePlan(opts: RePlanOptions): Promise<RecoveryResult> {
  if (opts.keyboardFallback) {
    await uia.call("press_key", { keys: opts.keyboardFallback }).catch(() => {})
    return { recovered: true, strategy: `rePlan: keyboard ${opts.keyboardFallback}` }
  }
  if (opts.coordinateFallback) {
    await uia.call("click_point", { x: opts.coordinateFallback.x, y: opts.coordinateFallback.y, button: "left" }).catch(() => {})
    return { recovered: true, strategy: `rePlan: coordinate click (${opts.coordinateFallback.x},${opts.coordinateFallback.y})` }
  }
  return { recovered: false, strategy: "rePlan: no fallback configured" }
}

// ===========================================================================
// Full recovery ladder — tries all strategies in order
// ===========================================================================

export interface RecoveryContext {
  staleRef: string
  role: string
  name: string
  hwnd?: number
  replanOptions?: RePlanOptions
}

export async function recover(context: RecoveryContext, maxRetries = DEFAULT_RETRIES): Promise<RecoveryResult> {
  const strategies = [
    { name: "reResolve", fn: () => tryReResolve(context.staleRef) },
    { name: "reFocus", fn: () => tryReFocus(context.hwnd ?? null) },
    {
      name: "reScan",
      fn: () => tryReScan(context.role, context.name, context.hwnd),
    },
    {
      name: "rePlan",
      fn: () => tryRePlan(context.replanOptions ?? {}),
    },
  ]

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RECOVERY_DELAY_MS))

    for (const strat of strategies) {
      try {
        const result = await strat.fn()
        if (result.recovered) {
          console.warn(`[recovery] attempt ${attempt + 1}/${maxRetries}: ${result.strategy}`)
          return result
        }
      } catch {
        // Strategy threw — continue to next
      }
    }
  }

  return { recovered: false, strategy: `all ${maxRetries} attempts exhausted` }
}

// ===========================================================================
// Self-healing action executor — execute with automatic recovery
// ===========================================================================

export async function executeWithRecovery(
  action: (ref: string) => Promise<{ ok?: boolean; error?: string }>,
  context: RecoveryContext,
): Promise<{ ok: boolean; recovery?: RecoveryResult }> {
  // First attempt
  const first = await action(context.staleRef).catch((e): { ok?: boolean; error?: string } => ({ error: e instanceof Error ? e.message : String(e) }))
  if (first.ok === true) return { ok: true }

  // Recovery ladder
  const recovered = await recover(context)
  if (!recovered.recovered || !recovered.newRef) {
    return { ok: false, recovery: recovered }
  }

  // Retry with recovered ref
  const retry = await action(recovered.newRef).catch((e): { ok?: boolean; error?: string } => ({ error: e instanceof Error ? e.message : String(e) }))
  return { ok: retry.ok === true, recovery: recovered }
}
