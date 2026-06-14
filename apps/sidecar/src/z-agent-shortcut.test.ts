import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __resetAgentShortcutStateForTest, agentPipeline } from "./pipeline/agent.js"
import type { Hooks } from "./harness/hooks.js"
import { closeMemorySubsystem } from "./memory/subsystem.js"

const sessionTurns: unknown[] = []
const spotifyQueries: string[] = []
const controlActions: string[] = []
const whatsAppSends: { recipient: string; message: string }[] = []
const notepadWrites: string[] = []
const notepadSaves: string[] = []
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
  controlSpotifyPlayback: async (action: string) => {
    controlActions.push(action)
    return { ok: true, action, target: "spotify" }
  },
  playSpotify: async (query: string) => {
    spotifyQueries.push(query)
    return { ok: true }
  },
  sendWhatsAppMessage: async (recipient: string, message: string) => {
    whatsAppSends.push({ recipient, message })
    return { ok: true }
  },
  saveWindowsNotepadAs: async (path: string) => {
    notepadSaves.push(path)
    return { ok: true as const, app: "Notepad" as const, path }
  },
  writeWindowsNotepad: async (text: string) => {
    notepadWrites.push(text)
    return { ok: true as const, app: "Notepad" as const, method: "set_value" }
  },
}

async function drain(input: Parameters<typeof agentPipeline>[0]) {
  const events = []
  for await (const event of agentPipeline(input, {
    hooks: fakeHooks,
    writeSessionTurn: async (turn) => {
      sessionTurns.push(turn)
    },
  }))
    events.push(event)
  return events
}

const describe_ = process.env.CI ? describe.skip : describe

describe_("agent shortcut memory", () => {
  beforeEach(async () => {
    sessionTurns.length = 0
    spotifyQueries.length = 0
    controlActions.length = 0
    whatsAppSends.length = 0
    notepadWrites.length = 0
    notepadSaves.length = 0
    __resetAgentShortcutStateForTest()
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

  it("cleans filler words from Spotify song requests", async () => {
    await drain({ text: "open spotify and play Stay song", plan: "max" })

    expect(spotifyQueries).toEqual(["Stay"])
    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "open spotify and play Stay song",
      output: "Playing Stay on Spotify.",
      summary: "Playing Stay on Spotify.",
    })
  })

  it("routes background transport commands to control_spotify (media keys)", async () => {
    await drain({ text: "pause spotify in the background", plan: "max" })
    expect(controlActions).toEqual(["pause"])

    controlActions.length = 0
    await drain({ text: "next song in the background", plan: "max" })
    expect(controlActions).toEqual(["next"])
  })

  it("routes bare transport commands (no 'song'/'music' word) to control_spotify", async () => {
    await drain({ text: "play the next", plan: "max" })
    expect(controlActions).toEqual(["next"])
    expect(spotifyQueries).toEqual([]) // must NOT search for a song called "next"

    controlActions.length = 0
    await drain({ text: "previous", plan: "max" })
    expect(controlActions).toEqual(["previous"])

    controlActions.length = 0
    await drain({ text: "skip", plan: "max" })
    expect(controlActions).toEqual(["next"])
  })

  it("still treats 'play <song>' as a search, not a transport command", async () => {
    await drain({ text: "play despacito", plan: "max" })
    expect(controlActions).toEqual([])
    expect(spotifyQueries).toEqual(["despacito"])
  })

  it("keeps song and artist text as a Spotify query", async () => {
    await drain({ text: "play Stay Justin Bieber", plan: "max" })
    expect(controlActions).toEqual([])
    expect(spotifyQueries).toEqual(["Stay Justin Bieber"])
  })

  it("strips background phrasing without detaching Spotify playback", async () => {
    await drain({ text: "play Stay by Kid Laroi in the background", plan: "max" })
    expect(spotifyQueries).toEqual(["Stay by Kid Laroi"])
    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "play Stay by Kid Laroi in the background",
      output: "Playing Stay by Kid Laroi on Spotify.",
      summary: "Playing Stay by Kid Laroi on Spotify.",
    })
  })

  it("routes normal Spotify requests through the foreground playback helper", async () => {
    await drain({ text: "play rain sounds on spotify", plan: "max" })
    expect(spotifyQueries).toEqual(["rain sounds"])
  })

  it("skips the action and emits no error when the request is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const events = []
    for await (const event of agentPipeline(
      { text: "play lofi beats on spotify", plan: "max" },
      {
        hooks: fakeHooks,
        writeSessionTurn: async (turn) => {
          sessionTurns.push(turn)
        },
        signal: controller.signal,
      },
    ))
      events.push(event)
    // A superseded run must not drive the app or surface a red error.
    expect(spotifyQueries).toEqual([])
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  // ── WhatsApp tests commented out (will provide later) ──────────────────
  // it("writes successful WhatsApp shortcuts to session memory", ...)
  // it("end-to-end routes a natural 'text <name> saying <msg>' to send_whatsapp_message", ...)
  // it("routes 'send hi to my mom lily on whatsapp' to Lily", ...)
  // it("routes send-to-self WhatsApp commands to the You chat", ...)
  // it("holds a reminder draft and sends it on the follow-up recipient command", ...)
  // it("sends a pending reminder draft when the follow-up says message me", ...)
  // it("sends a pending reminder draft when the follow-up references the told text", ...)
  // it("does not let a pending draft steal a fresh explicit WhatsApp message", ...)

  it("writes explicit Windows Notepad commands to Notepad instead of WhatsApp", async () => {
    await drain({ text: "write buy milk in notepad", plan: "max" })

    expect(notepadWrites).toEqual(["buy milk"])
    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "write buy milk in notepad",
      output: "I wrote it in Windows Notepad.",
      summary: "I wrote it in Windows Notepad.",
    })
  })

  it("asks for a save location after drafting in Windows Notepad", async () => {
    await drain({ text: "write buy milk in notepad and save it", plan: "max" })

    expect(notepadWrites).toEqual(["buy milk"])
    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "write buy milk in notepad and save it",
      output:
        "I wrote it in Windows Notepad. Where should I save the file, and what should I name it?",
      summary:
        "I wrote it in Windows Notepad. Where should I save the file, and what should I name it?",
    })
  })

  it("writes and saves a Notepad draft when a destination is given directly", async () => {
    await drain({ text: "save this notepad file to desktop as yomi-automation-smoke", plan: "max" })

    expect(notepadWrites).toEqual([])
    expect(notepadSaves).toEqual(["desktop as yomi-automation-smoke"])
    expect(sessionTurns).toContainEqual({
      kind: "agent",
      input: "save this notepad file to desktop as yomi-automation-smoke",
      output: expect.stringContaining("I saved the Notepad file to"),
      summary: expect.stringContaining("I saved the Notepad file to"),
    })
  })
})
