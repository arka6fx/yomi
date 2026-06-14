import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { describe, expect, it } from "bun:test"
import { automationArtifactRoot, writeFailureArtifact } from "./failure-artifacts.js"

describe("failure artifacts", () => {
  it("writes replayable failure files under the temp directory", async () => {
    const artifact = await writeFailureArtifact({
      runId: "run/test:1",
      action: { kind: "invoke", ref: "w1e1" },
      error: new Error("boom"),
      attempts: [{ attempt: 1, ref: "w1e1", stale: true, error: "stale" }],
      recovery: { recovered: false, strategy: "all exhausted" },
      snapshot: { window: "Calculator", elements: [] },
      focusTree: { ok: true, elements: [] },
      screenshotB64: Buffer.from("png").toString("base64"),
    })

    expect(artifact.dir.startsWith(automationArtifactRoot())).toBe(true)
    expect(artifact.dir.startsWith(tmpdir())).toBe(true)
    expect(existsSync(artifact.manifestPath)).toBe(true)
    expect(artifact.files.some((file) => file.endsWith("uia-snapshot.json"))).toBe(true)
    expect(artifact.files.some((file) => file.endsWith("screenshot.b64.txt"))).toBe(true)

    const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8"))
    expect(manifest).toMatchObject({ runId: "run/test:1", error: { message: "boom" } })
  })
})
