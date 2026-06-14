import { describe, expect, it } from "bun:test"
import { nativeProvider } from "./native.js"
import { createWorkflowProvider } from "./workflow.js"
import { apiProvider } from "./api.js"
import { getConnectorRegistry } from "../../connectors/registry.js"

describe("native provider health", () => {
  it("is always unavailable (desktop automation not shipping)", async () => {
    const health = await nativeProvider.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.detail).toContain("not available")
  })

  it("diagnostics report available: false", async () => {
    const diag = await nativeProvider.diagnostics()
    expect(diag.available).toBe(false)
  })
})

describe("api provider health", () => {
  it("reports no integrations connected when registry is empty", async () => {
    const health = await apiProvider.healthCheck()
    expect(health.ok).toBe(true)
    expect(health.detail).toContain("no integrations")
  })

  it("diagnostics list connected provider ids", async () => {
    const reg = getConnectorRegistry()
    const original = reg.getConnected.bind(reg)
    reg.getConnected = () => ["notion", "github"]
    try {
      const diag = await apiProvider.diagnostics()
      expect(diag.integrations).toEqual(["notion", "github"])
    } finally {
      reg.getConnected = original
    }
  })

  it("healthCheck reports count when integrations are connected", async () => {
    const reg = getConnectorRegistry()
    const original = reg.getConnected.bind(reg)
    reg.getConnected = () => ["notion"]
    try {
      const health = await apiProvider.healthCheck()
      expect(health.ok).toBe(true)
      expect(health.detail).toContain("1 integration")
    } finally {
      reg.getConnected = original
    }
  })
})

describe("workflow provider health", () => {
  it("reports an empty but reachable replay catalog", async () => {
    const provider = createWorkflowProvider({
      countWorkflowReplays: () => 0,
      listWorkflowReplays: () => [],
    })

    const health = await provider.healthCheck()
    const diagnostics = await provider.diagnostics()

    expect(health.ok).toBe(true)
    expect(health.detail).toContain("0 replayable")
    expect(diagnostics).toEqual({ workflows: 0, total: 0, recent: [] })
  })

  it("surfaces recent replayable workflows in diagnostics", async () => {
    const provider = createWorkflowProvider({
      countWorkflowReplays: () => 2,
      listWorkflowReplays: () => [
        {
          replayId: "replay-run-1",
          task: "play lofi on spotify",
          ownerId: "spotify",
          ownerLabel: "Spotify Agent",
          status: "completed",
          startedAt: "2026-06-05T00:00:00.000Z",
          endedAt: "2026-06-05T00:00:03.000Z",
          summary: "Playing lofi.",
        },
      ],
    })

    const health = await provider.healthCheck()
    const diagnostics = await provider.diagnostics()

    expect(health.detail).toContain("2 replayable")
    expect(diagnostics.recent).toEqual([
      {
        replayId: "replay-run-1",
        task: "play lofi on spotify",
        owner: "Spotify Agent",
        endedAt: "2026-06-05T00:00:03.000Z",
        summary: "Playing lofi.",
      },
    ])
  })
})
