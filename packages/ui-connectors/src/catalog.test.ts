import { describe, expect, it } from "bun:test"
import { buildCatalog } from "./catalog.js"
import { accountLabel } from "./components/ConnectorMarketplace.js"

describe("accountLabel", () => {
  // The card title already says "Google Calendar", so "Calendar (arka@example.com)"
  // spent its width repeating that and ellipsised the only part that mattered.
  it("keeps only the account from a name-wrapped display name", () => {
    expect(accountLabel("Calendar (owner@example.com)")).toBe("owner@example.com")
    expect(accountLabel("Classroom (me@college.edu)")).toBe("me@college.edu")
  })

  it("passes through a name that is already bare", () => {
    expect(accountLabel("owner@example.com")).toBe("owner@example.com")
    expect(accountLabel("Google Meet")).toBe("Google Meet")
  })

  it("renders nothing when there is no display name", () => {
    expect(accountLabel(undefined)).toBeUndefined()
  })
})

describe("buildCatalog", () => {
  // Each connector is a separate OAuth grant, so Gmail can sit on one Google account
  // while Classroom sits on another. The dashboard fetched the account name and then
  // dropped it, so every tile just said "CONNECTED" — and a user had no way to tell
  // that their Classroom was bound to a different account than everything else.
  it("carries the connected account through to the tile", () => {
    const catalog = buildCatalog(["google", "google-classroom"], {
      google: "arka@personal.example",
      "google-classroom": "arka@college.example",
    })

    const gmail = catalog.find((c) => c.id === "google")
    const classroom = catalog.find((c) => c.id === "google-classroom")

    expect(gmail?.displayName).toBe("arka@personal.example")
    expect(classroom?.displayName).toBe("arka@college.example")
  })

  it("marks unconnected connectors without an account", () => {
    const catalog = buildCatalog(["google"], { google: "arka@personal.example" })
    const meet = catalog.find((c) => c.id === "google-meet")

    expect(meet?.connected).toBe(false)
    expect(meet?.displayName).toBeUndefined()
  })
})
