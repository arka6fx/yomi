import { describe, expect, it } from "bun:test"
import { whatsAppMessageRequest, windowsNotepadRequest } from "./agent.js"

describe("whatsAppMessageRequest", () => {
  it("parses 'send <msg> to <name>'", () => {
    expect(whatsAppMessageRequest("send hi to lily on WhatsApp")).toEqual({
      recipient: "lily",
      message: "hi",
    })
    expect(whatsAppMessageRequest("send hi to myself on WhatsApp")).toEqual({
      recipient: "you",
      message: "hi",
    })
    expect(whatsAppMessageRequest("send a reminder to me on WhatsApp")).toEqual({
      recipient: "you",
      message: "a reminder",
    })
    expect(whatsAppMessageRequest("i am saying send hi to my mom lily on whatsapp")).toEqual({
      recipient: "lily",
      message: "hi",
    })
  })

  it("parses separator phrasings (saying/that/:)", () => {
    expect(whatsAppMessageRequest("text John saying I'll be late")).toEqual({
      recipient: "John",
      message: "I'll be late",
    })
    expect(whatsAppMessageRequest("message mom that I'm coming home")).toEqual({
      recipient: "mom",
      message: "I'm coming home",
    })
  })

  it("parses bare '<verb> <name> <msg>' (name = first word, or 'my <x>')", () => {
    expect(whatsAppMessageRequest("text dad good morning")).toEqual({
      recipient: "dad",
      message: "good morning",
    })
    expect(whatsAppMessageRequest("whatsapp myself buy milk")).toEqual({
      recipient: "you",
      message: "buy milk",
    })
    expect(whatsAppMessageRequest("text my brother on my way")).toEqual({
      recipient: "brother",
      message: "on my way",
    })
  })

  it("uses the spoken name after a relationship label", () => {
    expect(whatsAppMessageRequest("message my mother Lily that I am leaving")).toEqual({
      recipient: "Lily",
      message: "I am leaving",
    })
    expect(whatsAppMessageRequest("send hi to my mom on WhatsApp")).toEqual({
      recipient: "mom",
      message: "hi",
    })
  })

  it("returns null for non-messaging or incomplete text", () => {
    expect(whatsAppMessageRequest("what's the weather today")).toBeNull()
    expect(whatsAppMessageRequest("tell me a joke")).toBeNull() // 'tell' only with a separator
    expect(whatsAppMessageRequest("text John")).toBeNull() // no message
    expect(whatsAppMessageRequest("play despacito")).toBeNull()
    expect(whatsAppMessageRequest("write buy milk in notepad")).toBeNull()
    expect(whatsAppMessageRequest("write things you know about me in notepad")).toBeNull()
  })

  it("detects Windows Notepad write requests separately", () => {
    expect(windowsNotepadRequest("write buy milk in notepad")).toEqual({
      content: "buy milk",
      needsMemory: false,
      wantsSave: false,
    })
    expect(windowsNotepadRequest("write what you know about me in notepad")).toEqual({
      content: "what you know about me",
      needsMemory: true,
      wantsSave: false,
    })
    expect(windowsNotepadRequest("wright thingsyou knoe about me in the notepad")).toEqual({
      content: "thingsyou knoe about me",
      needsMemory: true,
      wantsSave: false,
    })
  })
})
