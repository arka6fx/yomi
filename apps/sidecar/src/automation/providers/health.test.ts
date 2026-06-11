import { platform } from "node:os"
import { describe, expect, it } from "bun:test"
import { createNativeProvider } from "./native.js"
import { createWorkflowProvider } from "./workflow.js"
import type { UiaPort } from "./types.js"

const okUia: UiaPort = {
  getWindowInfo: async () => ({ window: "Visual Studio Code" }),
  findWindow: async () => null,
}
const deadUia: UiaPort = {
  getWindowInfo: async () => {
    throw new Error("uia-helper exited")
  },
  findWindow: async () => null,
}

describe("native provider health", () => {
  it("reports healthy on Windows when the helper responds; gates off Windows", async () => {
    const health = await createNativeProvider(okUia).healthCheck()
    if (platform() === "win32") {
      expect(health.ok).toBe(true)
      expect(health.detail).toContain("Visual Studio Code")
    } else {
      expect(health.ok).toBe(false)
      expect(health.detail).toContain("Windows")
    }
  })

  it("reports unhealthy when the helper is unreachable on Windows", async () => {
    const health = await createNativeProvider(deadUia).healthCheck()
    if (platform() === "win32") expect(health.ok).toBe(false)
  })

  it("always reports a platform in diagnostics", async () => {
    const diag = await createNativeProvider(okUia).diagnostics()
    expect(diag.platform).toBe(platform())
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
