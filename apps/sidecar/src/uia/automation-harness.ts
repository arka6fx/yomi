export type RegressionScenario = {
  id: string
  title: string
  requiresWindowsE2e: boolean
  artifactKinds: string[]
}

export const REGRESSION_SCENARIOS: RegressionScenario[] = [
  { id: "stale-ref", title: "stale refs are re-resolved or reported", requiresWindowsE2e: false, artifactKinds: ["uia-snapshot", "attempts"] },
  { id: "modal-dialog", title: "modal dialogs are snapshotted with focus context", requiresWindowsE2e: true, artifactKinds: ["uia-snapshot", "focus-tree", "screenshot"] },
  { id: "offscreen-element", title: "offscreen elements fail actionability or scroll into view", requiresWindowsE2e: false, artifactKinds: ["uia-snapshot"] },
  { id: "disabled-control", title: "disabled controls fail before action", requiresWindowsE2e: false, artifactKinds: ["uia-snapshot"] },
  { id: "large-tree", title: "large trees truncate deterministically", requiresWindowsE2e: false, artifactKinds: ["uia-snapshot"] },
  { id: "blocklisted-window", title: "blocklisted windows are not captured or acted on", requiresWindowsE2e: false, artifactKinds: ["error"] },
  { id: "focus-loss", title: "focus loss is recorded and recovery can refocus", requiresWindowsE2e: true, artifactKinds: ["events", "focus-tree"] },
]

export function shouldRunWindowsAutomationE2e(env: Record<string, string | undefined> = process.env): boolean {
  return env.YOMI_RUN_WINDOWS_AUTOMATION_E2E === "true" && process.platform === "win32"
}

export function getRegressionScenario(id: string): RegressionScenario | undefined {
  return REGRESSION_SCENARIOS.find((scenario) => scenario.id === id)
}
