import { describe, expect, it } from "bun:test"
import type { GatewayMessage } from "@yomi/shared"
import { TelegramAdapter, type TelegramUpdate } from "./telegram.js"

function makeAdapter() {
  const adapter = new TelegramAdapter("dummy-token")
  const received: GatewayMessage[] = []
  adapter.setMessageHandler((msg) => {
    received.push(msg)
  })
  return { adapter, received }
}

describe("TelegramAdapter.processUpdate — location", () => {
  it("surfaces a location-only update as a GatewayMessage with location set", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
        location: { latitude: 12.9716, longitude: 77.5946 },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(1)
    expect(received[0]?.location).toEqual({ latitude: 12.9716, longitude: 77.5946 })
    expect(received[0]?.text).toBe("")
  })

  it("still drops an update with no text, no attachments, and no location", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 101,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(0)
  })
})
