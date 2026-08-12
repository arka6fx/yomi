import { afterEach, describe, expect, it } from "bun:test"
import { isTelegramMiniApp, openExternal } from "./telegram-webapp.js"

// bun test has no DOM by default, so `window` doesn't exist unless a test
// stubs it in — these helpers only ever run client-side in the browser, but
// exercising them here still catches real logic bugs (the Telegram-context
// branch vs. the plain-navigation fallback).
type FakeWindow = {
  Telegram?: { WebApp?: { initData?: string; openLink?: (url: string, options?: unknown) => void } }
  location: { href: string }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe("isTelegramMiniApp", () => {
  it("is false when window is absent (e.g. during SSR)", () => {
    expect(isTelegramMiniApp()).toBe(false)
  })

  it("is false when window.Telegram is absent", () => {
    globalThis.window = { location: { href: "" } } as unknown as Window & typeof globalThis
    expect(isTelegramMiniApp()).toBe(false)
  })

  it("is false when Telegram.WebApp has no initData", () => {
    globalThis.window = {
      Telegram: { WebApp: {} },
      location: { href: "" },
    } as unknown as Window & typeof globalThis
    expect(isTelegramMiniApp()).toBe(false)
  })

  it("is true when Telegram.WebApp.initData is populated", () => {
    globalThis.window = {
      Telegram: { WebApp: { initData: "query_id=abc&user=%7B%22id%22%3A42%7D" } },
      location: { href: "" },
    } as unknown as Window & typeof globalThis
    expect(isTelegramMiniApp()).toBe(true)
  })
})

describe("openExternal", () => {
  it("calls Telegram.WebApp.openLink when inside a Telegram Mini App", () => {
    const calls: { url: string; options?: unknown }[] = []
    const fake: FakeWindow = {
      Telegram: {
        WebApp: {
          initData: "query_id=abc",
          openLink: (url, options) => {
            calls.push({ url, options })
          },
        },
      },
      location: { href: "" },
    }
    globalThis.window = fake as unknown as Window & typeof globalThis

    openExternal("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")

    expect(calls).toEqual([
      {
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
        options: { try_instant_view: false },
      },
    ])
    expect(fake.location.href).toBe("")
  })

  it("falls back to window.location.href when not inside a Telegram Mini App", () => {
    const fake: FakeWindow = { location: { href: "" } }
    globalThis.window = fake as unknown as Window & typeof globalThis

    openExternal("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")

    expect(fake.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")
  })

  it("falls back to window.location.href when initData is present but openLink is missing", () => {
    const fake: FakeWindow = {
      Telegram: { WebApp: { initData: "query_id=abc" } },
      location: { href: "" },
    }
    globalThis.window = fake as unknown as Window & typeof globalThis

    openExternal("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")

    expect(fake.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")
  })
})
