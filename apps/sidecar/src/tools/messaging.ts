import { tool, jsonSchema } from "ai"

const BACKEND_URL =
  process.env.YOMI_BACKEND_URL ?? process.env.BACKEND_URL ?? "http://localhost:3001"

export function createMessagingTools() {
  return {
    send_message: tool({
      description:
        "Send a message to a connected messaging platform (Telegram). " +
        "Requires the platform to be linked to the user's account first.",
      parameters: jsonSchema<{ platform: string; chatId: string; text: string }>({
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["telegram"],
            description: "Target messaging platform",
          },
          chatId: { type: "string", description: "Recipient chat/channel ID" },
          text: { type: "string", description: "Message text to send" },
        },
        required: ["platform", "chatId", "text"],
      }),
      execute: async ({ platform, chatId, text }) => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/gateway/send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.YOMI_SESSION_TOKEN}`,
            },
            body: JSON.stringify({ platform, chatId, text }),
          })
          const data = (await res.json()) as { ok: boolean; messageId?: string; error?: string }
          return data
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    list_platforms: tool({
      description: "List connected messaging platforms and active gateway sessions.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
      }),
      execute: async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/gateway/connections`, {
            headers: {
              Authorization: `Bearer ${process.env.YOMI_SESSION_TOKEN}`,
            },
          })
          if (!res.ok) return { error: "Failed to fetch connected platforms" }
          const data = await res.json()
          return { platforms: data }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),
  }
}
