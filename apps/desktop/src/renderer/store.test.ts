import { beforeEach, describe, expect, it } from "bun:test"
import type { AutomationRun } from "@yomi/shared"
import { useYomiStore } from "./store"

function makeRun(id: string): AutomationRun {
  return {
    id,
    owner: { id: "spotify", label: "Spotify Agent" },
    task: "play lofi",
    state: "executing",
    startedAt: new Date().toISOString(),
    timeline: [],
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      yomi: {
        getAutomationHealth: async () => ({
          ok: true,
          providers: [{ id: "native", label: "Native UIA", ok: true }],
        }),
        repairAutomationProvider: async (providerId: string) => ({
          provider: { id: providerId, label: "Native UIA", ok: true, detail: "repaired" },
        }),
        getAutomationKnowledge: async (goal: string) => ({
          agent: { id: "spotify", label: "Spotify Agent", provider: "native" },
          hint: `Prior experience for ${goal}`,
          workflows: [
            {
              id: "wf-1",
              agentId: "spotify",
              goal,
              tools: ["play_spotify"],
              stepCount: 1,
              recoveryCount: 0,
              durationMs: 900,
              outcome: "success" as const,
              summary: "played",
              createdAt: "2026-06-05T00:00:00.000Z",
            },
          ],
          recoveries: [],
        }),
        getAutomationWorkflows: async () => ({
          workflows: [
            {
              replayId: "replay-1",
              task: "play focus music",
              ownerId: "spotify",
              ownerLabel: "Spotify Agent",
              status: "completed",
              startedAt: "2026-06-05T00:00:00.000Z",
              endedAt: "2026-06-05T00:00:03.000Z",
              summary: "Playing focus music.",
            },
          ],
        }),
      },
    },
  })
  useYomiStore.setState({
    missionsOpen: false,
    automationRuns: [],
    activeAutomationRunId: null,
    pendingAct: null,
    providerHealth: [],
    providerHealthStatus: "idle",
    providerHealthError: null,
    providerHealthUpdatedAt: null,
    repairingProviderId: null,
    knowledgePreview: null,
    knowledgePreviewGoal: null,
    knowledgePreviewStatus: "idle",
    knowledgePreviewError: null,
    workflowCatalog: [],
    workflowCatalogStatus: "idle",
    workflowCatalogError: null,
  })
})

describe("missions panel state", () => {
  it("toggles open and closed", () => {
    expect(useYomiStore.getState().missionsOpen).toBe(false)
    useYomiStore.getState().toggleMissions()
    expect(useYomiStore.getState().missionsOpen).toBe(true)
    useYomiStore.getState().toggleMissions()
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("setMissionsOpen sets the value explicitly", () => {
    useYomiStore.getState().setMissionsOpen(true)
    expect(useYomiStore.getState().missionsOpen).toBe(true)
    useYomiStore.getState().setMissionsOpen(false)
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("auto-opens when a risky act is proposed", () => {
    useYomiStore.getState().handleSseEvent({
      type: "act_proposed",
      id: "a1",
      action: { kind: "click_point", x: 1, y: 1 },
      label: "Open Chrome",
      risky: true,
    })
    expect(useYomiStore.getState().pendingAct).toEqual({ id: "a1", label: "Open Chrome" })
    expect(useYomiStore.getState().missionsOpen).toBe(true)
  })

  it("does not auto-open for a non-risky act", () => {
    useYomiStore.getState().handleSseEvent({
      type: "act_proposed",
      id: "a2",
      action: { kind: "click_point", x: 1, y: 1 },
      label: "Scroll down",
      risky: false,
    })
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("auto-opens on a dangerous automation wait", () => {
    const run = makeRun("r1")
    useYomiStore.setState({ automationRuns: [run], activeAutomationRunId: "r1" })
    useYomiStore.getState().handleSseEvent({
      type: "automation_waiting",
      runId: "r1",
      reason: "confirm purchase",
      risk: "dangerous",
    })
    expect(useYomiStore.getState().missionsOpen).toBe(true)
    expect(useYomiStore.getState().automationRuns[0]!.state).toBe("needs_approval")
  })

  it("does not auto-open on a safe automation wait", () => {
    const run = makeRun("r2")
    useYomiStore.setState({ automationRuns: [run], activeAutomationRunId: "r2" })
    useYomiStore.getState().handleSseEvent({
      type: "automation_waiting",
      runId: "r2",
      reason: "thinking",
      risk: "safe",
    })
    expect(useYomiStore.getState().missionsOpen).toBe(false)
  })

  it("loads provider health", async () => {
    await useYomiStore.getState().loadProviderHealth()
    expect(useYomiStore.getState().providerHealthStatus).toBe("ready")
    expect(useYomiStore.getState().providerHealth).toEqual([
      { id: "native", label: "Native UIA", ok: true },
    ])
    expect(useYomiStore.getState().providerHealthUpdatedAt).toBeString()
  })

  it("captures provider health errors", async () => {
    window.yomi.getAutomationHealth = async () => {
      throw new Error("health unavailable")
    }
    await useYomiStore.getState().loadProviderHealth()
    expect(useYomiStore.getState().providerHealthStatus).toBe("error")
    expect(useYomiStore.getState().providerHealthError).toBe("health unavailable")
  })

  it("repairs a provider and replaces its health row", async () => {
    useYomiStore.setState({
      providerHealth: [{ id: "native", label: "Native UIA", ok: false, detail: "down" }],
    })

    await useYomiStore.getState().repairProvider("native")

    expect(useYomiStore.getState().repairingProviderId).toBeNull()
    expect(useYomiStore.getState().providerHealthStatus).toBe("ready")
    expect(useYomiStore.getState().providerHealth).toEqual([
      { id: "native", label: "Native UIA", ok: true, detail: "repaired" },
    ])
  })

  it("captures provider repair errors", async () => {
    window.yomi.repairAutomationProvider = async () => {
      throw new Error("repair unavailable")
    }

    await useYomiStore.getState().repairProvider("browser")

    expect(useYomiStore.getState().repairingProviderId).toBeNull()
    expect(useYomiStore.getState().providerHealthStatus).toBe("error")
    expect(useYomiStore.getState().providerHealthError).toBe("repair unavailable")
  })

  it("loads prior experience for a mission goal", async () => {
    await useYomiStore.getState().loadKnowledgePreview("play lofi")

    expect(useYomiStore.getState().knowledgePreviewStatus).toBe("ready")
    expect(useYomiStore.getState().knowledgePreview?.agent.label).toBe("Spotify Agent")
    expect(useYomiStore.getState().knowledgePreview?.workflows[0]?.tools).toEqual([
      "play_spotify",
    ])
  })

  it("does not let a stale knowledge lookup overwrite the current goal", async () => {
    let releaseSlow!: (value: Awaited<ReturnType<typeof window.yomi.getAutomationKnowledge>>) => void
    window.yomi.getAutomationKnowledge = (goal: string) => {
      if (goal === "slow") {
        return new Promise((resolve) => {
          releaseSlow = resolve
        })
      }
      return Promise.resolve({
        agent: { id: "browser", label: "Browser Agent", provider: "browser" },
        hint: "fast hint",
        workflows: [],
        recoveries: [],
      })
    }

    const slow = useYomiStore.getState().loadKnowledgePreview("slow")
    await useYomiStore.getState().loadKnowledgePreview("fast")
    releaseSlow({
      agent: { id: "spotify", label: "Spotify Agent", provider: "native" },
      hint: "slow hint",
      workflows: [],
      recoveries: [],
    })
    await slow

    expect(useYomiStore.getState().knowledgePreviewGoal).toBe("fast")
    expect(useYomiStore.getState().knowledgePreview?.agent.label).toBe("Browser Agent")
  })

  it("loads replayable workflow catalog", async () => {
    await useYomiStore.getState().loadWorkflowCatalog()

    expect(useYomiStore.getState().workflowCatalogStatus).toBe("ready")
    expect(useYomiStore.getState().workflowCatalog[0]?.replayId).toBe("replay-1")
  })

  it("captures workflow catalog errors", async () => {
    window.yomi.getAutomationWorkflows = async () => {
      throw new Error("catalog unavailable")
    }

    await useYomiStore.getState().loadWorkflowCatalog()

    expect(useYomiStore.getState().workflowCatalogStatus).toBe("error")
    expect(useYomiStore.getState().workflowCatalogError).toBe("catalog unavailable")
  })
})
