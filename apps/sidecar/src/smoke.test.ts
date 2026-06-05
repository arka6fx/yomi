import { describe, expect, it } from "bun:test"
import {
  playbackControl,
  spotifyPlaybackQuery,
  volumeAction,
  whatsAppMessageRequest,
  reminderDraftRequest,
  pendingDraftRecipientRequest,
  stripDetachedPhrases,
} from "./pipeline/shortcuts.js"
import { resolveAgent, scopeTools } from "./automation/agents/registry.js"
import { classifyAutomationOwner } from "./automation/runs.js"

describe("smoke: shortcut parsers", () => {
  it("playbackControl: next/previous/pause/resume/stop", () => {
    expect(playbackControl("next song")).toBe("next")
    expect(playbackControl("skip")).toBe("next")
    expect(playbackControl("previous")).toBe("previous")
    expect(playbackControl("pause spotify")).toBe("pause")
    expect(playbackControl("resume")).toBe("resume")
    expect(playbackControl("stop the music")).toBe("stop")
    expect(playbackControl("what's the weather")).toBeNull()
  })

  it("spotifyPlaybackQuery: extracts song/artist", () => {
    expect(spotifyPlaybackQuery("play despacito")).toBe("despacito")
    expect(spotifyPlaybackQuery("play Stay Justin Bieber")).toBe("Stay Justin Bieber")
    expect(spotifyPlaybackQuery("play rain sounds on spotify")).toBe("rain sounds")
    expect(spotifyPlaybackQuery("play youtube video")).toBeNull()
    expect(spotifyPlaybackQuery("what's the weather")).toBeNull()
  })

  it("volumeAction: system and spotify volume", () => {
    expect(volumeAction("turn volume up")).toEqual({ direction: "up", steps: 2, target: "system" })
    expect(volumeAction("lower the volume a lot")).toEqual({ direction: "down", steps: 5, target: "system" })
    expect(volumeAction("mute")).toEqual({ direction: "mute", steps: 1, target: "system" })
    expect(volumeAction("increase spotify volume")).toEqual({ direction: "up", steps: 3, target: "spotify" })
    expect(volumeAction("hello")).toBeNull()
  })

  it("whatsAppMessageRequest: parses send commands", () => {
    expect(whatsAppMessageRequest("send hi to lily on WhatsApp")).toEqual({
      recipient: "lily",
      message: "hi",
    })
    expect(whatsAppMessageRequest("text dad good morning")).toEqual({
      recipient: "dad",
      message: "good morning",
    })
    expect(whatsAppMessageRequest("send hi to myself on WhatsApp")).toEqual({
      recipient: "you",
      message: "hi",
    })
    expect(whatsAppMessageRequest("what's the weather")).toBeNull()
  })

  it("reminderDraftRequest: parses reminder drafts", () => {
    expect(reminderDraftRequest("write a reminder about buying milk and send to whatsapp")).toEqual({
      message: "Reminder: buying milk",
    })
    expect(reminderDraftRequest("what's the weather")).toBeNull()
  })

  it("pendingDraftRecipientRequest: parses follow-up recipient", () => {
    expect(pendingDraftRecipientRequest("send the reminder to myself", true)).toBe("you")
    expect(pendingDraftRecipientRequest("send it to lily", true)).toBe("lily")
    expect(pendingDraftRecipientRequest("send it to lily", false)).toBeNull()
  })

  it("stripDetachedPhrases: removes background phrasing", () => {
    expect(stripDetachedPhrases("play despacito in the background")).toBe("play despacito")
    expect(stripDetachedPhrases("pause spotify quietly")).toBe("pause spotify")
    expect(stripDetachedPhrases("turn volume up")).toBe("turn volume up")
  })
})

describe("smoke: agent registry", () => {
  it("resolves spotify agent for play commands", () => {
    const agent = resolveAgent("play despacito on spotify")
    expect(agent.id).toBe("spotify")
    expect(agent.provider).toBe("native")
    expect(agent.toolNames).toContain("play_spotify")
  })

  it("resolves browser agent for browser commands", () => {
    const agent = resolveAgent("open google.com in the browser")
    expect(agent.id).toBe("browser")
    expect(agent.provider).toBe("browser")
    expect(agent.toolPrefixes).toContain("browser_")
  })

  it("resolves messaging agent for whatsapp commands", () => {
    const agent = resolveAgent("send hi to lily on whatsapp")
    expect(agent.id).toBe("messaging")
  })

  it("falls back to automation agent for unknown goals", () => {
    const agent = resolveAgent("do something complex")
    expect(agent.id).toBe("automation")
  })

  it("scopeTools limits tools to agent allowance", () => {
    const fakeTools = {
      play_spotify: {},
      control_spotify: {},
      browser_navigate: {},
      look_at_screen: {},
      read_file: {},
      search: {},
    } as any
    const agent = resolveAgent("play despacito on spotify")
    const scoped = scopeTools(fakeTools, agent)
    expect(Object.keys(scoped)).toContain("play_spotify")
    expect(Object.keys(scoped)).toContain("control_spotify")
    expect(Object.keys(scoped)).toContain("look_at_screen")
    expect(Object.keys(scoped)).not.toContain("browser_navigate")
  })
})

describe("smoke: owner classification", () => {
  it("classifies spotify commands", () => {
    expect(classifyAutomationOwner("play despacito on spotify").id).toBe("spotify")
  })

  it("classifies browser commands", () => {
    expect(classifyAutomationOwner("open google.com in the browser").id).toBe("browser")
  })

  it("classifies whatsapp commands", () => {
    expect(classifyAutomationOwner("send hi to lily on whatsapp").id).toBe("messaging")
  })

  it("classifies notepad commands", () => {
    expect(classifyAutomationOwner("write buy milk in notepad").id).toBe("windows")
  })
})
