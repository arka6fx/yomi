import { describe, expect, it } from "bun:test"
import { createAgentTools } from "./index.js"

async function callTool(
  tools: Record<string, any>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools[name]
  if (!tool?.execute) throw new Error(`no tool ${name}`)
  return await tool.execute(args, { toolCallId: "t1", messages: [] } as never)
}

describe("createAgentTools", () => {
  it("does not expose file-backed skill tools", () => {
    const tools: Record<string, any> = createAgentTools({ plan: "pro" })
    expect(tools["skill_list"]).toBeUndefined()
    expect(tools["skill_view"]).toBeUndefined()
    expect(tools["skill_read_file"]).toBeUndefined()
    expect(tools["skill_create"]).toBeUndefined()
  })

  it("includes memory, system, web, delegate, cron, messaging, and integration tools", () => {
    const tools: Record<string, any> = createAgentTools({ plan: "pro" })
    expect(tools["add_memory"]).toBeDefined()
    expect(tools["retrieve_memory"]).toBeDefined()
    expect(tools["bash"]).toBeDefined()
    expect(tools["web_search"]).toBeDefined()
    expect(tools["fetch_url"]).toBeDefined()
    expect(tools["delegate_task"]).toBeDefined()
    expect(tools["cronjob"]).toBeDefined()
    expect(tools["send_message"]).toBeDefined()
    expect(tools["gmail-searchEmails"]).toBeDefined()
  })
})

describe("delegate_task tool is wired in", () => {
  it("calling delegate_task without goal or tasks returns a clear error", async () => {
    const tools = createAgentTools({ plan: "pro" })
    const r = (await callTool(tools, "delegate_task", {})) as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/either goal/)
  })
})

describe("connector tools are wired into createAgentTools", () => {
  it("includes legacy integration tools (gmail)", () => {
    const tools: Record<string, unknown> = createAgentTools()
    expect(tools["gmail-searchEmails"]).toBeDefined()
    expect(tools["gmail-sendEmail"]).toBeDefined()
  })
})
