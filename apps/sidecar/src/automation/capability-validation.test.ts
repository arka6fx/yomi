import { afterEach, describe, expect, it } from "bun:test"
import {
  buildCoverageDashboard,
  CapabilityRegistry,
  hasObjectivePassingEvidence,
  renderCoverageDashboardMarkdown,
  runCapabilityValidation,
} from "./capability-validation.js"

process.env.YOMI_CAPABILITY_REGISTRY = ":memory:"

describe("capability validation", () => {
  afterEach(() => {
    process.env.YOMI_CAPABILITY_REGISTRY = ":memory:"
  })

  it("rejects false success without objective evidence", async () => {
    const result = await runCapabilityValidation({
      capability: "office.word.save",
      category: "office",
      execute: async () => ({ ok: true }),
      validate: async () => [],
    })

    expect(result.status).toBe("fail")
    expect(hasObjectivePassingEvidence(result.evidence)).toBe(false)
  })

  it("passes only when objective validators pass", async () => {
    const result = await runCapabilityValidation({
      capability: "file.delete",
      category: "filesystem",
      execute: async () => ({ ok: true }),
      validate: async () => [{ kind: "filesystem", label: "file no longer exists", passed: true }],
    })

    expect(result.status).toBe("pass")
  })

  it("updates capability registry with success rates", async () => {
    const registry = new CapabilityRegistry(":memory:")
    await runCapabilityValidation({
      capability: "spotify.playback",
      category: "spotify",
      execute: async () => ({ ok: true }),
      validate: async () => [{ kind: "audio_state", label: "track position increased", passed: true }],
    }, registry)

    const record = registry.list()[0]
    expect(record).toMatchObject({ capability: "spotify.playback", successRate: 1, passCount: 1, testCount: 1 })
  })

  it("prioritizes weakest dashboard areas", () => {
    const dashboard = buildCoverageDashboard([
      { capability: "spotify", category: "media", status: "verified", successRate: 0.99, confidence: 1, knownFailures: [], testCount: 20, passCount: 20, lastTested: new Date().toISOString() },
      { capability: "bluetooth", category: "system", status: "degraded", successRate: 0.7, confidence: 0.5, knownFailures: ["pairing timeout"], testCount: 10, passCount: 7 },
      { capability: "premiere.export", category: "creative", status: "degraded", successRate: 0.82, confidence: 0.7, knownFailures: [], testCount: 10, passCount: 8 },
    ])

    expect(dashboard.weakest[0]?.capability).toBe("bluetooth")
    expect(dashboard.capabilities.find((item) => item.capability === "spotify")?.priorityReason).toBe("healthy")
  })

  it("renders a coverage dashboard markdown report", () => {
    const dashboard = buildCoverageDashboard([
      { capability: "whatsapp.messaging", category: "messaging", status: "verified", successRate: 0.98, confidence: 0.9, knownFailures: [], testCount: 50, passCount: 49, lastTested: new Date().toISOString() },
    ])
    const markdown = renderCoverageDashboardMarkdown(dashboard)

    expect(markdown).toContain("# Capability Coverage Dashboard")
    expect(markdown).toContain("whatsapp.messaging")
  })
})
