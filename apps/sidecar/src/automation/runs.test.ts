import { afterEach, describe, expect, it } from "bun:test"
import {
  __resetAutomationRunsForTest,
  buildAutomationPreview,
  classifyAutomationOwner,
  classifyAutomationRisk,
  completeAutomation,
  failAutomation,
  getReplayCommand,
  listWorkflowReplays,
  redactAutomationPayload,
  startAutomationRun,
  timelineAutomation,
} from "./runs.js"

process.env.YOMI_AUTOMATION_DB = ":memory:"

describe("automation runs", () => {
  afterEach(() => {
    __resetAutomationRunsForTest()
  })

  it("classifies owners from task text", () => {
    expect(classifyAutomationOwner("play focus music on Spotify").label).toBe("Spotify Agent")
    expect(classifyAutomationOwner("open example.com in the browser").label).toBe(
      "Automation Agent",
    )
    expect(classifyAutomationOwner("send a message on WhatsApp").label).toBe("Messaging Agent")
  })

  it("classifies risky actions", () => {
    expect(classifyAutomationRisk("open spotify")).toBe("safe")
    expect(classifyAutomationRisk("create a calendar event")).toBe("moderate")
    expect(classifyAutomationRisk("send the email")).toBe("dangerous")
  })

  it("builds preview and timeline events", () => {
    const session = startAutomationRun("research this in the background")
    const preview = buildAutomationPreview(session.run.task)
    const event = timelineAutomation(session, "Opened browser", "done")
    expect(preview.steps.length).toBeGreaterThan(0)
    expect(event.type).toBe("automation_timeline")
    expect(session.run.timeline).toHaveLength(1)
  })

  it("redacts large and sensitive payloads", () => {
    const payload = redactAutomationPayload({
      token: "secret",
      screenshot_b64: "x".repeat(300),
      value: "ok",
    })
    expect(payload).toEqual({ token: "[redacted]", screenshot_b64: "[redacted]", value: "ok" })
  })

  it("lists only completed runs as replayable workflows", () => {
    const completed = startAutomationRun("play lofi on spotify")
    completeAutomation(completed, "Playing lofi.")
    const failed = startAutomationRun("send a message")
    failAutomation(failed, "approval denied")
    startAutomationRun("open calculator")

    const replays = listWorkflowReplays()
    const replayId = completed.run.replayId
    if (!replayId) throw new Error("completed run should have a replay id")

    expect(replays).toHaveLength(1)
    expect(replays[0]!.replayId).toBe(replayId)
    expect(replays[0]!.task).toBe("play lofi on spotify")
    expect(getReplayCommand(replayId)).toBe("play lofi on spotify")
  })

  it("returns the newest replayable workflows first and honors the limit", () => {
    const first = startAutomationRun("open the browser")
    completeAutomation(first, "Opened browser.")
    const second = startAutomationRun("play focus music")
    completeAutomation(second, "Playing focus music.")

    const replays = listWorkflowReplays(1)
    const replayId = second.run.replayId
    if (!replayId) throw new Error("completed run should have a replay id")

    expect(replays).toHaveLength(1)
    expect(replays[0]!.replayId).toBe(replayId)
    expect(replays[0]!.summary).toBe("Playing focus music.")
  })
})
