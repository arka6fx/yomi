import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentPipeline } from "./pipeline/agent.js"
import type { Hooks } from "./harness/hooks.js"
import { closeMemorySubsystem } from "./memory/subsystem.js"

const sessionTurns: unknown[] = []
let tempDir = ""

const fakeHooks: Hooks = {
  onSessionStart: async () => {},
  onUserPromptSubmit: async () => {},
  onPreToolUse: async () => ({ ok: true }),
  onPostToolUse: async (_toolName: string, result: unknown) => result,
  onStop: async () => {},
  onSessionEnd: async () => {},
}

const fakeSystem = {
  adjustSystemVolume: async () => ({ ok: true }),
  adjustSpotifyVolume: async () => ({ ok: true }),
  playSpotify: async () => ({ ok: true }),
  sendWhatsAppMessage: async () => ({ ok: true }),
}

async function drain(input: Parameters<typeof agentPipeline>[0]) {
  const events = []
  for await (const event of agentPipeline(input, {
    hooks: fakeHooks,
    system: fakeSystem,
    writeSessionTurn: async (turn) => {
      sessionTurns.push(turn)
    },
  }))
    events.push(event)
  return events
}

describe("agent shortcut memory", () => {
  beforeEach(async () => {
    sessionTurns.length = 0
    tempDir = await mkdtemp(join(tmpdir(), "yomi-agent-shortcut-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    closeMemorySubsystem()
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("writes successful volume shortcuts to session memory", async () => {
    await drain({ text: "turn volume up", plan: "max" })

    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "turn volume up",
      output: "Volume adjusted.",
      summary: "Volume adjusted.",
    })
  })

  it("writes successful Spotify shortcuts to session memory", async () => {
    await drain({ text: "play rain sounds on spotify", plan: "max" })

    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "play rain sounds on spotify",
      output: "Playing rain sounds on Spotify.",
      summary: "Playing rain sounds on Spotify.",
    })
  })

  it("writes successful WhatsApp shortcuts to session memory", async () => {
    await drain({ text: "send hello to Riya on WhatsApp", plan: "max" })

    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "send hello to Riya on WhatsApp",
      output: 'Sent "hello" to Riya on WhatsApp.',
      summary: 'Sent "hello" to Riya on WhatsApp.',
    })
  })
})
