import { describe, expect, it } from "bun:test"
import { creditRenewal } from "./entitlements.js"

const SIGNUP = new Date("2026-07-14T09:00:00Z")

const base = {
  id: "user_1",
  email: "user@example.com",
  role: "user",
  createdAt: SIGNUP,
  trialEndDate: null,
  currentPeriodEnd: null,
}

describe("creditRenewal", () => {
  it("reports the explore renewal date, not a calendar-month reset", () => {
    const renewal = creditRenewal({
      ...base,
      plan: "explore",
      trialEndDate: new Date("2026-08-13T09:00:00Z"),
    })

    expect(renewal.kind).toBe("renewal")
    expect(renewal.at?.toISOString()).toBe("2026-08-13T09:00:00.000Z")
  })

  it("falls back to signup + 30 days when an explore user has no trialEndDate", () => {
    const renewal = creditRenewal({ ...base, plan: "explore" })

    expect(renewal.kind).toBe("renewal")
    expect(renewal.at?.toISOString()).toBe("2026-08-13T09:00:00.000Z")
  })

  it("reports the dodo billing period end for a paid plan", () => {
    const renewal = creditRenewal({
      ...base,
      plan: "pro",
      currentPeriodEnd: new Date("2026-08-14T09:00:00Z"),
    })

    expect(renewal.kind).toBe("renewal")
    expect(renewal.at?.toISOString()).toBe("2026-08-14T09:00:00.000Z")
  })

  it("reports no renewal when a paid plan has no billing period yet", () => {
    const renewal = creditRenewal({ ...base, plan: "max" })

    expect(renewal.kind).toBe("none")
    expect(renewal.at).toBeNull()
  })
})
