import { describe, expect, it } from "bun:test"
import { supabaseComposioSpecs } from "./supabase.js"

describe("supabaseComposioSpecs", () => {
  // Confirmed live (GET /api/v3/tools?tool_slugs=SUPABASE_DEPLOY_FUNCTION): `file`
  // (the function source) is required and was missing from the spec entirely —
  // the tool could never actually deploy anything as declared.
  it("SUPABASE_DEPLOY_FUNCTION requires file", () => {
    const spec = supabaseComposioSpecs.find((s) => s.slug === "SUPABASE_DEPLOY_FUNCTION")!
    const base = { ref: "proj_ref" }

    expect(spec.parameters.safeParse(base).success).toBe(false)
    expect(spec.parameters.safeParse({ ...base, file: "export default () => new Response('ok')" }).success).toBe(true)
  })
})
