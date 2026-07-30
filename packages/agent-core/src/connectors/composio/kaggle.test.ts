import { describe, expect, it } from "bun:test"
import { kaggleComposioSpecs } from "./kaggle.js"

describe("kaggleComposioSpecs", () => {
  // Confirmed live (GET /api/v3/tools?tool_slugs=KAGGLE_DATASET_VERSION): `files`
  // (an array of upload-token references) is required and was missing entirely —
  // the model had no way to discover the call needs it.
  it("KAGGLE_DATASET_VERSION requires files", () => {
    const spec = kaggleComposioSpecs.find((s) => s.slug === "KAGGLE_DATASET_VERSION")!
    const base = {
      owner_slug: "zynicide",
      dataset_slug: "world-development-indicators",
      version_notes: "Updated CSVs",
    }

    expect(spec.parameters.safeParse(base).success).toBe(false)
    expect(spec.parameters.safeParse({ ...base, files: [{ token: "tok_1" }] }).success).toBe(true)
  })
})
