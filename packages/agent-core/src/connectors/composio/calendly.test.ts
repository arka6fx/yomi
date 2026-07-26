import { describe, expect, it } from "bun:test"
import { calendlyComposioSpecs } from "./calendly.js"

describe("calendlyComposioSpecs", () => {
  // Confirmed live (GET /api/v3/tools?tool_slugs=CALENDLY_CREATE_ONE_OFF_EVENT_TYPE):
  // date_setting is required and was missing from the spec entirely — the model had
  // no way to discover it needed to supply one, so every call would 422.
  it("CALENDLY_CREATE_ONE_OFF_EVENT_TYPE requires date_setting", () => {
    const spec = calendlyComposioSpecs.find((s) => s.slug === "CALENDLY_CREATE_ONE_OFF_EVENT_TYPE")!
    const base = { name: "Quick sync", host: "https://api.calendly.com/users/u1", duration: 30 }

    expect(spec.parameters.safeParse(base).success).toBe(false)
    expect(
      spec.parameters.safeParse({
        ...base,
        date_setting: { type: "date_range", start_date: "2026-08-01", end_date: "2026-08-31" },
      }).success,
    ).toBe(true)
  })

  // Confirmed live (GET /api/v3/tools?tool_slugs=CALENDLY_CREATE_WEBHOOK_SUBSCRIPTION):
  // organization is required and was missing entirely from the spec.
  it("CALENDLY_CREATE_WEBHOOK_SUBSCRIPTION requires organization", () => {
    const spec = calendlyComposioSpecs.find((s) => s.slug === "CALENDLY_CREATE_WEBHOOK_SUBSCRIPTION")!
    const base = {
      url: "https://yourapp.com/webhook",
      events: ["invitee.created"],
      scope: "organization",
    }

    expect(spec.parameters.safeParse(base).success).toBe(false)
    expect(
      spec.parameters.safeParse({
        ...base,
        organization: "https://api.calendly.com/organizations/o1",
      }).success,
    ).toBe(true)
  })
})
