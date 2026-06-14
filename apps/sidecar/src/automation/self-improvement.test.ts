import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { failureAnalysisMarkdown, readStrategies, recordSuccessfulStrategy, writeFailureAnalysis } from "./self-improvement.js"

let dir = ""

describe("self improvement", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "yomi-self-improve-"))
    process.env.YOMI_SUCCESSFUL_STRATEGIES = join(dir, "successful_strategy.json")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.YOMI_SUCCESSFUL_STRATEGIES
  })

  it("generates failure analysis with root cause and suggested fixes", () => {
    const md = failureAnalysisMarkdown({
      capability: "office.word.save",
      status: "fail",
      durationMs: 120,
      error: "file missing",
      evidence: [{ kind: "filesystem", label: "expected Office file exists", passed: false, detail: "sample.docx" }],
    })

    expect(md).toContain("# Failure Analysis: office.word.save")
    expect(md).toContain("Root cause: file missing")
    expect(md).toContain("Verify the save path")
  })

  it("writes failure_analysis.md", async () => {
    const path = writeFailureAnalysis({
      capability: "spotify.play",
      status: "fail",
      durationMs: 20,
      evidence: [{ kind: "audio_state", label: "track position increased", passed: false }],
    }, dir)

    expect(await readFile(path, "utf8")).toContain("spotify.play")
  })

  it("records successful strategies for reuse", () => {
    recordSuccessfulStrategy({
      task: "office.word.open_edit_save_reopen",
      strategy: "Use Save As path, poll filesystem, reopen and read content.",
      successRate: 0.98,
      evidenceLabels: ["expected Office file exists", "Office file is readable"],
    })

    const strategies = readStrategies()
    expect(strategies[0]).toMatchObject({ task: "office.word.open_edit_save_reopen", successRate: 0.98 })
  })
})
