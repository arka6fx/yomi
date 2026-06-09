import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { classifyRisk, confirmRisky, isBlockedApp, registerConfirmer } from "./safety.js"

describe("isBlockedApp", () => {
  it("blocks password managers and banking apps", () => {
    expect(isBlockedApp("1Password")).toBe(true)
    expect(isBlockedApp("Bitwarden - Vault")).toBe(true)
    expect(isBlockedApp("Chase Online Banking")).toBe(true)
  })
  it("allows ordinary apps", () => {
    expect(isBlockedApp("rust.txt - Notepad")).toBe(false)
    expect(isBlockedApp("Calculator")).toBe(false)
  })
})

describe("classifyRisk", () => {
  it("flags destructive labels", () => {
    expect(classifyRisk("invoke", { name: "Delete account" }).risky).toBe(true)
    expect(classifyRisk("invoke", { name: "Send" }).risky).toBe(true)
    expect(classifyRisk("invoke", { name: "Pay now" }).risky).toBe(true)
  })
  it("flags typing into password fields", () => {
    expect(classifyRisk("set_value", { name: "Password" }).risky).toBe(true)
  })
  it("treats ordinary actions as safe", () => {
    expect(classifyRisk("invoke", { name: "File" }).risky).toBe(false)
    expect(classifyRisk("set_value", { name: "Search" }).risky).toBe(false)
  })
})

describe("confirmRisky", () => {
  beforeEach(() => {
    delete process.env.YOMI_ACT_AUTOCONFIRM
    registerConfirmer(null)
  })
  afterEach(() => {
    registerConfirmer(null)
    delete process.env.YOMI_ACT_AUTOCONFIRM
  })

  it("blocks risky actions when no confirmer is registered", async () => {
    expect(await confirmRisky("Delete", "destructive")).toBe(false)
  })
  it("honors the autoconfirm escape hatch", async () => {
    process.env.YOMI_ACT_AUTOCONFIRM = "true"
    expect(await confirmRisky("Delete", "destructive")).toBe(true)
  })
  it("delegates to a registered confirmer", async () => {
    registerConfirmer(async () => true)
    expect(await confirmRisky("Delete", "destructive")).toBe(true)
    registerConfirmer(async () => false)
    expect(await confirmRisky("Delete", "destructive")).toBe(false)
  })
})
