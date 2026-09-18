import { afterEach, describe, expect, it } from "bun:test"
import { toolkitsForProviders } from "./composio-catalog.js"

const original = process.env["COMPOSIO_CONNECTORS"]

afterEach(() => {
  if (original === undefined) delete process.env["COMPOSIO_CONNECTORS"]
  else process.env["COMPOSIO_CONNECTORS"] = original
})

// A Gmail-only user must trigger one catalog fetch, not 57: fetching every
// configured toolkit's catalog on a cold isolate blew the Worker's 50-subrequest
// cap and killed the agent loop's reply send.
describe("toolkitsForProviders", () => {
  it("keeps only configured connectors the user has connected", () => {
    process.env["COMPOSIO_CONNECTORS"] = "google,slack,linear,github"
    expect(toolkitsForProviders(["google"])).toEqual(["google"])
    expect(toolkitsForProviders(["google", "slack"])).toEqual(["google", "slack"])
  })

  it("drops connected providers that are not Composio-configured", () => {
    process.env["COMPOSIO_CONNECTORS"] = "google,slack"
    expect(toolkitsForProviders(["google", "github", "google-calendar"])).toEqual(["google"])
  })

  it("dedupes repeated providers", () => {
    process.env["COMPOSIO_CONNECTORS"] = "google,slack"
    expect(toolkitsForProviders(["google", "google", "slack"])).toEqual(["google", "slack"])
  })

  it("returns nothing when no Composio connectors are configured", () => {
    delete process.env["COMPOSIO_CONNECTORS"]
    expect(toolkitsForProviders(["google", "slack"])).toEqual([])
  })
})
