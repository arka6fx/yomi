import { describe, expect, it } from "bun:test"
import { getRegressionScenario, REGRESSION_SCENARIOS, shouldRunWindowsAutomationE2e } from "./automation-harness.js"

describe("automation harness", () => {
  it("registers required regression scenarios", () => {
    expect(REGRESSION_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "stale-ref",
      "modal-dialog",
      "offscreen-element",
      "disabled-control",
      "large-tree",
      "blocklisted-window",
      "focus-loss",
    ])
    expect(getRegressionScenario("blocklisted-window")?.artifactKinds).toContain("error")
  })

  it("requires an explicit Windows e2e flag", () => {
    expect(shouldRunWindowsAutomationE2e({ YOMI_RUN_WINDOWS_AUTOMATION_E2E: "false" })).toBe(false)
    expect(shouldRunWindowsAutomationE2e({})).toBe(false)
  })
})
