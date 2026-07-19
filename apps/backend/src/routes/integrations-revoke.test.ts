import { describe, expect, it } from "bun:test"
import { shouldRevokeGoogleGrant } from "./integrations.js"

describe("shouldRevokeGoogleGrant", () => {
  // All six Google connectors share one OAuth client, and Google treats a user's
  // authorization to a client as a single grant. Revoking on every disconnect meant
  // dropping Gmail 401'd Calendar, Drive, Classroom, Tasks and Meet too.
  const allGoogle = [
    "google",
    "google-calendar",
    "google-drive",
    "google-classroom",
    "google-tasks",
    "google-meet",
  ]

  it("does not revoke while other google connectors are still connected", () => {
    expect(shouldRevokeGoogleGrant("google", allGoogle)).toBe(false)
    expect(shouldRevokeGoogleGrant("google-drive", allGoogle)).toBe(false)
  })

  it("revokes when the last google connector is disconnected", () => {
    expect(shouldRevokeGoogleGrant("google", ["google"])).toBe(true)
    expect(shouldRevokeGoogleGrant("google-meet", ["google-meet", "notion", "slack"])).toBe(true)
  })

  it("ignores non-google connectors entirely", () => {
    expect(shouldRevokeGoogleGrant("notion", ["notion", "google"])).toBe(false)
    expect(shouldRevokeGoogleGrant("slack", ["slack"])).toBe(false)
  })

  it("does not count the connector being disconnected as a reason to keep the grant", () => {
    // The row being deleted is still in the list at the time of the check.
    expect(shouldRevokeGoogleGrant("google-tasks", ["google-tasks"])).toBe(true)
  })
})
