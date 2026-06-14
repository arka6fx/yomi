import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "bun:test"
import { createOfficeOpenEditCapability, officeCapabilityName, validateOfficeFileEvidence } from "./office-capabilities.js"
import { runCapabilityValidation } from "./capability-validation.js"

const dir = join(tmpdir(), "yomi-office-capability-test")
const file = join(dir, "sample.docx")
process.env.YOMI_CAPABILITY_REGISTRY = ":memory:"

describe("office capabilities", () => {
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("validates Office files with independent filesystem evidence", () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, "docx-bytes", "utf8")
    const evidence = validateOfficeFileEvidence("word", file, "docx-bytes")

    expect(evidence.every((item) => item.passed)).toBe(true)
  })

  it("fails Office validation when the expected file was not created", async () => {
    const capability = createOfficeOpenEditCapability({ app: "word", filePath: file })
    const result = await runCapabilityValidation(capability)

    expect(capability.capability).toBe(officeCapabilityName("word", "open_edit_save_reopen"))
    expect(result.status).toBe("fail")
    expect(result.evidence.find((item) => item.label.includes("exists"))?.passed).toBe(false)
  })
})
