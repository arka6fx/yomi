import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  initUsageStore,
  closeUsageStore,
  logUsageEvent,
  queryUsageEvents,
  querySessions,
  queryDailyUsage,
  queryHourlyActivity,
  queryModelDistribution,
  querySessionLengths,
  resetUsageStore,
  startSession,
  completeSession,
} from "./usage-store.js"
import { generateReport, getMaxLookback, formatTerminal } from "./insights-engine.js"
import type { Plan } from "@yomi/shared"

let tmpBase: string

beforeEach(async () => {
  tmpBase = join(tmpdir(), "yomi-insights-test", Math.random().toString(36).slice(2))
  await mkdir(tmpBase, { recursive: true })
  process.env["YOMI_NOTEPAD_DIR"] = tmpBase
  await initUsageStore()
})

afterEach(async () => {
  await resetUsageStore()
  closeUsageStore()
  await rm(tmpBase, { recursive: true, force: true }).catch(() => {})
  delete process.env["YOMI_NOTEPAD_DIR"]
})

describe("usage-store", () => {
  it("logs and retrieves usage events", async () => {
    logUsageEvent({ kind: "fast_query" })
    logUsageEvent({ kind: "agent_run" })
    logUsageEvent({ kind: "stt" })

    const events = queryUsageEvents(30)
    expect(events).toHaveLength(3)
    expect(events[0]!.kind).toBe("fast_query")
    expect(events[1]!.kind).toBe("agent_run")
    expect(events[2]!.kind).toBe("stt")
  })

  it("filters events by lookback window", async () => {
    logUsageEvent({ kind: "fast_query" })
    logUsageEvent({ kind: "agent_run" })

    const within1 = queryUsageEvents(1)
    expect(within1).toHaveLength(2)

    const within0 = queryUsageEvents(0)
    expect(within0).toHaveLength(0)
  })

  it("logs events with custom fields", async () => {
    logUsageEvent({
      kind: "agent_run",
      model: "gpt-5.4-mini",
      inputTokens: 500,
      outputTokens: 200,
      costCents: 3,
    })

    const events = queryUsageEvents(7)
    expect(events).toHaveLength(1)
    expect(events[0]!.model).toBe("gpt-5.4-mini")
    expect(events[0]!.inputTokens).toBe(500)
    expect(events[0]!.outputTokens).toBe(200)
    expect(events[0]!.costCents).toBe(3)
  })

  it("manages session lifecycle", async () => {
    const id = startSession({ kind: "agent", model: "gpt-5.4-mini" })
    expect(id).toBeTruthy()

    const sessions = querySessions(7)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.status).toBe("active")
    expect(sessions[0]!.endedAt).toBeNull()

    completeSession(id, { inputTokens: 1000, outputTokens: 500, costCents: 5, status: "completed" })

    const completed = querySessions(7)
    expect(completed).toHaveLength(1)
    expect(completed[0]!.status).toBe("completed")
    expect(completed[0]!.endedAt).not.toBeNull()
    expect(completed[0]!.inputTokens).toBe(1000)
    expect(completed[0]!.outputTokens).toBe(500)
    expect(completed[0]!.costCents).toBe(5)
  })

  it("provides daily usage aggregation", async () => {
    logUsageEvent({ kind: "fast_query" })
    logUsageEvent({ kind: "fast_query" })
    logUsageEvent({ kind: "agent_run" })

    const daily = queryDailyUsage(7)
    expect(daily.length).toBeGreaterThanOrEqual(1)
    const today = daily.find((d) => d.kind === "fast_query")
    expect(today).toBeDefined()
    expect(today!.count).toBe(2)
  })

  it("provides hourly activity breakdown", async () => {
    startSession({ kind: "fast" })
    startSession({ kind: "agent" })

    const hourly = queryHourlyActivity(7)
    expect(hourly.length).toBeGreaterThanOrEqual(1)
    const now = new Date()
    const currentHour = hourly.find((h) => h.hour === now.getHours())
    expect(currentHour).toBeDefined()
    expect(currentHour!.count).toBe(2)
  })

  it("provides model distribution", async () => {
    startSession({ kind: "fast", model: "gpt-5.4-mini" })
    startSession({ kind: "agent", model: "gpt-5.4-mini" })
    startSession({ kind: "agent", model: "gpt-5.4-mini" })

    const dist = queryModelDistribution(7)
    expect(dist).toHaveLength(1)
    const mini = dist.find((d) => d.model === "gpt-5.4-mini")
    expect(mini).toBeDefined()
    expect(mini!.count).toBe(3)
  })

  it("provides session length data", async () => {
    const id1 = startSession({ kind: "fast" })
    const id2 = startSession({ kind: "agent" })
    completeSession(id1)
    completeSession(id2)

    const lengths = querySessionLengths(7)
    expect(lengths).toHaveLength(2)
  })
})

describe("insights-engine", () => {
  it("generates a report with overview section", async () => {
    logUsageEvent({ kind: "fast_query" })
    logUsageEvent({ kind: "agent_run" })
    const sid = startSession({ kind: "fast", model: "gpt-5.4-mini" })
    completeSession(sid, { inputTokens: 100, outputTokens: 50 })

    const report = generateReport(7, "pro")
    expect(report.periodDays).toBe(7)
    expect(report.plan).toBe("pro")
    expect(report.overview.totalSessions).toBe(1)
    expect(report.overview.totalQueries).toBe(2)
    expect(report.overview.fastSessions).toBe(1)
    expect(report.overview.agentSessions).toBe(0)
    expect(report.generatedAt).toBeTruthy()
  })

  it("respects plan-based lookback limits", async () => {
    expect(getMaxLookback("explore")).toBe(7)
    expect(getMaxLookback("pro")).toBe(90)
    expect(getMaxLookback("max")).toBe(365)
  })

  it("clamps days to plan max lookback", async () => {
    logUsageEvent({ kind: "fast_query" })
    const report = generateReport(999, "explore")
    expect(report.periodDays).toBeLessThanOrEqual(7)
  })

  it("reports cost breakdown by kind", async () => {
    const sid1 = startSession({ kind: "fast", model: "gpt-5.4-mini" })
    completeSession(sid1, { inputTokens: 10000, outputTokens: 5000 })
    const sid2 = startSession({ kind: "agent", model: "gpt-5.4-mini" })
    completeSession(sid2, { inputTokens: 20000, outputTokens: 10000 })

    const report = generateReport(7, "pro")
    expect(report.costBreakdown.byKind.length).toBeGreaterThanOrEqual(1)
    expect(report.costBreakdown.totalCostCents).toBeGreaterThan(0)
  })

  it("includes model distribution section", async () => {
    startSession({ kind: "fast", model: "gpt-5.4-mini" })
    startSession({ kind: "agent", model: "gpt-5.4-mini" })

    const report = generateReport(7, "pro")
    expect(report.modelDistribution.models.length).toBe(1)
  })

  it("includes activity section", async () => {
    startSession({ kind: "fast" })

    const report = generateReport(7, "pro")
    expect(report.activity.peakHour).toBeGreaterThanOrEqual(0)
    expect(report.activity.hourlyBreakdown.length).toBeGreaterThanOrEqual(1)
  })

  it("formats report as terminal string", async () => {
    logUsageEvent({ kind: "fast_query" })
    const sid = startSession({ kind: "fast", model: "gpt-5.4-mini" })
    completeSession(sid, { inputTokens: 100, outputTokens: 50 })

    const report = generateReport(7, "pro")
    const output = formatTerminal(report)
    expect(output).toContain("Yomi Insights")
    expect(output).toContain("Total sessions:")
    expect(output).toContain("Estimated cost:")
    expect(output).toContain("Overview")
  })

  it("handles empty data gracefully", async () => {
    const report = generateReport(7, "explore")
    expect(report.overview.totalSessions).toBe(0)
    expect(report.overview.totalQueries).toBe(0)
    expect(report.overview.estimatedCostCents).toBe(0)
    expect(report.modelDistribution.models).toHaveLength(0)
    expect(formatTerminal(report)).toContain("Yomi Insights")
  })

  it("estimates cost for known models", async () => {
    const sid = startSession({ kind: "agent", model: "gpt-5.4-mini" })
    completeSession(sid, { inputTokens: 10000, outputTokens: 5000 })
    const sid2 = startSession({ kind: "fast", model: "gpt-5.4-mini" })
    completeSession(sid2, { inputTokens: 20000, outputTokens: 10000 })

    const report = generateReport(7, "max")
    expect(report.costBreakdown.totalCostCents).toBeGreaterThan(0)
    expect(report.overview.totalTokens).toBe(45000)
  })

  it("handles unknown model pricing gracefully", async () => {
    const sid = startSession({ kind: "fast", model: "claude-4" })
    completeSession(sid, { inputTokens: 1000, outputTokens: 500 })

    const report = generateReport(7, "pro")
    expect(report.costBreakdown.totalCostCents).toBeGreaterThan(0)
    expect(report.modelDistribution.models[0]!.model).toBe("claude-4")
  })

  it("completeSession with no stats defaults to zeros", async () => {
    const id = startSession({ kind: "fast" })
    completeSession(id)

    const sessions = querySessions(7)
    expect(sessions[0]!.inputTokens).toBe(0)
    expect(sessions[0]!.outputTokens).toBe(0)
    expect(sessions[0]!.costCents).toBe(0)
    expect(sessions[0]!.status).toBe("completed")
  })

  it("terminal output contains all report sections", async () => {
    const sid = startSession({ kind: "agent", model: "gpt-5.4-mini" })
    completeSession(sid, { inputTokens: 500, outputTokens: 250 })
    startSession({ kind: "fast", model: "gpt-5.4-mini" })

    const report = generateReport(7, "pro")
    const output = formatTerminal(report)
    expect(output).toContain("Overview")
    expect(output).toContain("Token Consumption")
    expect(output).toContain("Cost Breakdown")
    expect(output).toContain("Model Distribution")
    expect(output).toContain("Activity")
    expect(output).toContain("gpt-5.4-mini")
    expect(output).toContain("gpt-5.4-mini")
  })
})
