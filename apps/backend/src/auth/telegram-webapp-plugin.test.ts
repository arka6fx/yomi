import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectResult: { userId: string }[] = []
let claimResult: { userId: string }[] = []
let claimedTokens: string[] = []
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(selectResult) }),
    }),
  }),
  insert: () => ({
    values: () => Promise.resolve(undefined),
  }),
  update: () => ({
    set: () => ({
      where: (whereArg: unknown) => {
        // The real query filters on token = $1 AND used_at IS NULL AND
        // expires_at > now() — the fake can't evaluate a drizzle where
        // expression, so it just records that an update was attempted and
        // returns whatever the test pre-set as the claim result.
        claimedTokens.push(String(whereArg))
        return { returning: () => Promise.resolve(claimResult) }
      },
    }),
  }),
}
mock.module("@yomi/db", () => ({
  db: fakeDb,
  platformConnections: {},
  telegramMiniappLoginTokens: { token: "token", userId: "user_id", usedAt: "used_at", expiresAt: "expires_at" },
}))

const { verifyTelegramInitData, resolveTelegramWebAppUserId, claimLoginToken } =
  await import("./telegram-webapp-plugin.js")

beforeEach(() => {
  selectResult = []
  claimResult = []
  claimedTokens = []
})

// Builds a validly-signed initData string the way Telegram's client does,
// so tests exercise the real verification algorithm end to end rather than
// a shortcut.
function signInitData(fields: Record<string, string>, botToken: string): string {
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

describe("claimLoginToken", () => {
  it("returns the userId when the atomic claim update returns a row", async () => {
    claimResult = [{ userId: "user_1" }]

    expect(await claimLoginToken("tok_valid")).toBe("user_1")
    expect(claimedTokens).toHaveLength(1)
  })

  it("returns null when the claim update returns no rows (missing, expired, or already used)", async () => {
    claimResult = []

    expect(await claimLoginToken("tok_gone")).toBeNull()
  })
})
