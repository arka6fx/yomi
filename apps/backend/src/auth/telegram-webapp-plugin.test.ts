import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectResult: { userId: string }[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResult) }),
    }),
  }),
}
mock.module("@yomi/db", () => ({ db: fakeDb, platformConnections: {} }))

const { verifyTelegramInitData, resolveTelegramWebAppUserId } = await import(
  "./telegram-webapp-plugin.js"
)

beforeEach(() => {
  selectResult = []
})

// Builds a validly-signed initData string the way Telegram's client does,
// so tests exercise the real verification algorithm end to end rather than
// a shortcut.
function signInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const params = new URLSearchParams(fields)
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest()
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
  params.set("hash", hash)
  return params.toString()
}

describe("verifyTelegramInitData", () => {
  const botToken = "test-bot-token"

  it("accepts a validly-signed initData string and extracts the telegram user id", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42, first_name: "Ada" }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      botToken,
    )

    expect(verifyTelegramInitData(initData, botToken)).toEqual({ telegramUserId: "42" })
  })

  it("rejects a tampered hash", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      botToken,
    )
    const tampered = initData.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64))

    expect(verifyTelegramInitData(tampered, botToken)).toBeNull()
  })

  it("rejects initData signed with a different bot token", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      },
      "a-different-token",
    )

    expect(verifyTelegramInitData(initData, botToken)).toBeNull()
  })

  it("rejects initData with no hash at all", () => {
    const params = new URLSearchParams({ user: JSON.stringify({ id: 42 }) })
    expect(verifyTelegramInitData(params.toString(), botToken)).toBeNull()
  })

  it("rejects an auth_date older than 24 hours", () => {
    const initData = signInitData(
      {
        user: JSON.stringify({ id: 42 }),
        auth_date: String(Math.floor(Date.now() / 1000) - 25 * 60 * 60),
      },
      botToken,
    )

    expect(verifyTelegramInitData(initData, botToken)).toBeNull()
  })

  it("rejects initData with no user field", () => {
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)) }, botToken)

    expect(verifyTelegramInitData(initData, botToken)).toBeNull()
  })
})

describe("resolveTelegramWebAppUserId", () => {
  it("returns the linked Yomi user id when the Telegram id is linked", async () => {
    selectResult = [{ userId: "user_1" }]

    expect(await resolveTelegramWebAppUserId("42")).toBe("user_1")
  })

  it("returns null when the Telegram id has no linked account", async () => {
    selectResult = []

    expect(await resolveTelegramWebAppUserId("42")).toBeNull()
  })
})
