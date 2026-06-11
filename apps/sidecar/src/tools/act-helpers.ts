import type { UiaAction } from "@yomi/shared"
import { uia } from "../uia/client.js"
import { classifyRisk, isBlockedApp } from "../uia/safety.js"
import { emitActResult, requestConfirmation } from "../uia/act-bus.js"

export function blockedGuard(): { error: string } | null {
  if (isBlockedApp(uia.lastWindow)) {
    return { error: `Refusing to act on "${uia.lastWindow}" — blocklisted app.` }
  }
  return null
}

export function actFailed(r: unknown): boolean {
  return (
    typeof r === "object" &&
    r !== null &&
    (("ok" in r && (r as { ok?: unknown }).ok === false) || "error" in r)
  )
}

export function withHint(result: unknown): unknown {
  if (typeof result === "object" && result !== null)
    return { ...(result as object), hint: "re-fetch get_ui_tree and try again" }
  return { error: String(result), hint: "re-fetch get_ui_tree and try again" }
}

// Retry up to maxRetries when the C# helper signals a stale ref.
// Each retry re-snapshots the tree, matches by automationId → name+role, and re-runs.
export async function attemptAct(
  ref: string,
  run: (ref: string) => Promise<unknown>,
  maxRetries = 3,
): Promise<{ result: unknown; retried: boolean }> {
  for (let i = 0; ; i++) {
    try {
      const result = await run(ref)
      if (!actFailed(result)) return { result, retried: i > 0 }
      const r = result as { error?: string }
      if (i < maxRetries && r.error?.includes?.("element no longer available")) {
        const fresh = await uia.reResolve(ref).catch(() => null)
        if (!fresh) return { result: withHint(r), retried: i > 0 }
        ref = fresh
        continue
      }
      return { result: withHint(r), retried: i > 0 }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (i < maxRetries && msg.includes("element no longer available")) {
        const fresh = await uia.reResolve(ref).catch(() => null)
        if (!fresh) return { result: { error: msg, hint: "element no longer exists" }, retried: i > 0 }
        ref = fresh
        continue
      }
      return { result: { error: msg, hint: "re-fetch get_ui_tree and try again" }, retried: i > 0 }
    }
  }
}

// Run a UIA action through the safety guard: blocklist → risk → confirm → execute (+retry) → report.
export async function guardedAct(
  action: { kind: string; ref: string },
  run: (ref: string) => Promise<unknown>,
) {
  const blocked = blockedGuard()
  if (blocked) {
    emitActResult(false, action.ref, blocked.error)
    return blocked
  }

  const el = uia.getElement(action.ref)
  if (!el) return { error: "element no longer available — call get_ui_tree again first" }

  const label = el.name || el.role || action.ref
  const { risky, reason } = classifyRisk(action.kind, el)
  if (risky) {
    const approved = await requestConfirmation(
      action as UiaAction,
      label,
      reason ?? "destructive action",
      el.rect,
    )
    if (!approved) {
      emitActResult(false, label, "not confirmed")
      return { ok: false, requiresConfirmation: true, label, reason }
    }
  }
  const { result, retried } = await attemptAct(action.ref, run)
  const failed = actFailed(result)
  emitActResult(!failed, label, failed ? "action did not succeed" : undefined)
  return retried && typeof result === "object" && result !== null
    ? { ...(result as object), retried }
    : result
}
