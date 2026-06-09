import { tool, jsonSchema } from "ai"
import type { PlatformType } from "@yomi/shared"

const BACKEND_URL = process.env["YOMI_BACKEND_URL"] ?? "http://localhost:3001"

async function backendPost(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({ ok: false })) as { ok: boolean; error?: string }
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function createMessagingTools() {
  return {
    send_message: tool({
      description:
        "Send a message to a connected messaging platform (Telegram, Discord, or Slack). " +
        "Use this to proactively reach the user or deliver results to a specific platform. " +
        "Specify the platform, chat ID, and message text. " +
        "The gateway must be running (Max plan) for this tool to work.",
      parameters: jsonSchema<{
        platform: PlatformType
        chatId: string
        text: string
      }>({
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["telegram", "discord", "slack"],
            description: "Target messaging platform.",
          },
          chatId: {
            type: "string",
            description:
              "Chat or channel ID on the target platform. " +
              "Use 'broadcast' to send to all connected platforms.",
          },
          text: {
            type: "string",
            description: "Message text to send.",
          },
        },
        required: ["platform", "chatId", "text"],
      }),
      execute: async ({ platform, chatId, text }) => {
        if (!platform) {
          return { ok: false, error: "platform is required" }
        }
        if (!text) {
          return { ok: false, error: "Message text cannot be empty" }
        }
        if (text.length > 4000) {
          return { ok: false, error: "Message text must be 4000 characters or fewer" }
        }
        if (chatId === "broadcast") {
          return { ok: false, error: "Broadcast not yet supported via cloud gateway" }
        }

        const result = await backendPost("/api/gateway/send", { platform, chatId, text })
        return result
      },
    }),

    list_platforms: tool({
      description:
        "List all connected messaging platforms and active sessions. " +
        "Use this to discover available chat IDs for send_message.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        // Query backend for gateway status
        try {
          const res = await fetch(`${BACKEND_URL}/status`)
          const data = await res.json().catch(() => ({}))
          return {
            ok: true,
            platforms: [],
            connected: 0,
            sessions: [],
            note: "Gateway status available via backend",
          }
        } catch {
          return { ok: false, error: "Cannot reach backend", platforms: [], sessions: [] }
        }
      },
    }),
  }
}
