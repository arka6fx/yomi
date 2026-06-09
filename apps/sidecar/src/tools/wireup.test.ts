import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-skill-wireup-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
  await mkdir(join(tempDir, "skills"), { recursive: true })
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import { createAgentTools } from "./index.js"
import { refreshSkillIndexBlock } from "../harness/prompt.js"
import { createReadOnlySkillTools } from "./skills/skill-tools-write.js"

async function callTool(
  tools: Record<string, any>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools[name]
  if (!tool?.execute) throw new Error(`no tool ${name}`)
  return await tool.execute(args, { toolCallId: "t1", messages: [] } as never)
}

describe("createAgentTools wires skill tools in", () => {
  it("includes skill tools in the agent tool set", () => {
    const tools: Record<string, any> = createAgentTools()
    expect(tools["skill_list"]).toBeDefined()
    expect(tools["skill_view"]).toBeDefined()
    expect(tools["skill_read_file"]).toBeDefined()
    expect(tools["skill_create"]).toBeDefined()
  })

  it("passes plan to skill-write tools for entitlement gating", async () => {
    const explore: Record<string, any> = createAgentTools({ plan: "explore" })
    const r = (await callTool(explore, "skill_create", {
      name: "demo",
      description: "x",
      body: "body",
    })) as { ok: boolean; reason?: string }
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Pro plan/i)
  })

  it("allows Pro plans to create skills", async () => {
    const pro: Record<string, any> = createAgentTools({ plan: "pro" })
    const r = (await callTool(pro, "skill_create", {
      name: "demo",
      description: "Demo skill.",
      body: "body",
    })) as { ok: boolean; name?: string }
    expect(r.ok).toBe(true)
    expect(r.name).toBe("demo")
  })
})

describe("system prompt skills index is wired through", () => {
  it("the index block contains a freshly written skill after refresh", async () => {
    const pro: Record<string, any> = createAgentTools({ plan: "pro" })
    await callTool(pro, "skill_create", {
      name: "fresh",
      description: "A fresh skill.",
      body: "body",
    })
    // The write tool schedules a refresh in the background; for the test
    // we await it explicitly so the assertion is deterministic.
    await refreshSkillIndexBlock()
    const { buildFastPrompt } = await import("../harness/prompt.js")
    const prompt = buildFastPrompt({})
    expect(prompt).toContain("fresh")
    expect(prompt).toContain("A fresh skill.")
  })
})

describe("createReadOnlySkillTools", () => {
  it("omits write tools", () => {
    const ro = createReadOnlySkillTools({ plan: "pro" })
    expect(ro["skill_create"]).toBeUndefined()
    expect(ro["skill_edit"]).toBeUndefined()
    expect(ro["skill_list"]).toBeDefined()
  })
})

describe("delegate_task tool is wired in", () => {
  it("includes delegate_task in the agent tool set", () => {
    const tools: Record<string, any> = createAgentTools()
    expect(tools["delegate_task"]).toBeDefined()
  })

  it("calling delegate_task without goal or tasks returns a clear error", async () => {
    const tools = createAgentTools({ plan: "pro" })
    const r = (await callTool(tools, "delegate_task", {})) as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/either goal/)
  })
})
