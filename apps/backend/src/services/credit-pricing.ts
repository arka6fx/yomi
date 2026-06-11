import { creditCost, type UsageCreditKind } from "@yomi/shared/plans"

export type BillableUsageKind = UsageCreditKind

export function creditsForUsage(kind: BillableUsageKind, input: { durationSeconds?: number } = {}): number {
  if (kind === "voice") {
    const minutes = Math.max(Math.ceil((input.durationSeconds ?? 60) / 60), 1)
    return creditCost(kind, minutes)
  }

  return creditCost(kind)
}
