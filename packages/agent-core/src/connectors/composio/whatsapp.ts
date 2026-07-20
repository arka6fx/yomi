import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const WHATSAPP_TOOLKIT = "whatsapp"

export const whatsappComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "WHATSAPP_GET_PHONE_NUMBERS",
    description:
      "List all phone numbers registered to your WhatsApp Business Account. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "WHATSAPP_GET_PHONE_NUMBER",
    description:
      "Get details about a specific WhatsApp Business phone number. Read-only.",
    parameters: z
      .object({
        phone_number_id: z.string().describe("WhatsApp Business phone number ID"),
      })
      .passthrough(),
  },
  {
    slug: "WHATSAPP_GET_BUSINESS_PROFILE",
    description:
      "Get business profile info for a WhatsApp Business phone number. Read-only.",
    parameters: z
      .object({
        phone_number_id: z.string().describe("Phone number ID to get the business profile for"),
      })
      .passthrough(),
  },
  {
    slug: "WHATSAPP_GET_MESSAGE_HISTORY",
    description:
      "Retrieve message history for a WhatsApp Business phone number. Read-only.",
    parameters: z
      .object({
        phone_number_id: z.string().describe("WhatsApp Business phone number ID"),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .passthrough(),
  },
  {
    slug: "WHATSAPP_GET_MESSAGE_TEMPLATES",
    description:
      "Get all message templates for the WhatsApp Business Account. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "WHATSAPP_GET_BUSINESS_ACCOUNT_DETAILS",
    description:
      "Get comprehensive details about a WhatsApp Business Account. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "WHATSAPP_GET_MEDIA_INFO",
    description:
      "Get metadata and download URL for uploaded WhatsApp media. Read-only.",
    parameters: z
      .object({
        media_id: z.string().describe("WhatsApp media ID"),
      })
      .passthrough(),
  },
  {
    slug: "WHATSAPP_GET_COMMERCE_SETTINGS",
    description:
      "Get commerce settings (cart/catalog visibility) for a phone number. Read-only.",
    parameters: z
      .object({
        phone_number_id: z.string().describe("WhatsApp Business phone number ID"),
      })
      .passthrough(),
  },

  // ── Write / Send actions (gated) ──────────────────────────────
  {
    slug: "WHATSAPP_SEND_MESSAGE",
    description:
      "Send a text message to a WhatsApp user. Requires user approval before it runs.",
    parameters: z
      .object({
        recipient_phone_number: z.string().describe("Recipient phone number in international format (e.g. 15551234567)"),
        message_text: z.string().describe("Message text content"),
        phone_number_id: z.string().describe("Your WhatsApp Business phone number ID to send from"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send WhatsApp message",
      preview: `To: ${String(a["recipient_phone_number"] ?? "")}\n\n${String(a["message_text"] ?? "").slice(0, 500)}`,
      confirmText: "Send message",
    }),
  },
  {
    slug: "WHATSAPP_SEND_TEMPLATE_MESSAGE",
    description:
      "Send a template message to a WhatsApp user (for messages outside 24hr window). Requires user approval before it runs.",
    parameters: z
      .object({
        recipient_phone_number: z.string().describe("Recipient phone number"),
        template_name: z.string().describe("Name of the approved message template"),
        template_language: z.string().describe("Template language code (e.g. 'en_US')"),
        phone_number_id: z.string().describe("Your WhatsApp Business phone number ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send WhatsApp template message",
      preview: `Send template "${String(a["template_name"] ?? "")}" to ${String(a["recipient_phone_number"] ?? "")}`,
      confirmText: "Send template",
    }),
  },
  {
    slug: "WHATSAPP_MARK_MESSAGE_AS_READ",
    description:
      "Mark a WhatsApp message as read. Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("The message ID to mark as read"),
        phone_number_id: z.string().describe("Your WhatsApp Business phone number ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Mark WhatsApp message as read",
      preview: `Mark message ${String(a["message_id"] ?? "")} as read`,
      confirmText: "Mark as read",
    }),
  },
  {
    slug: "WHATSAPP_CREATE_QR_CODE",
    description:
      "Create a QR code with a prefilled message for a WhatsApp Business number. Requires user approval before it runs.",
    parameters: z
      .object({
        phone_number_id: z.string().describe("Your WhatsApp Business phone number ID"),
        prefilled_message: z.string().describe("Pre-filled message text that appears when scanned"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create WhatsApp QR code",
      preview: `QR code with message: ${String(a["prefilled_message"] ?? "").slice(0, 200)}`,
      confirmText: "Create QR code",
    }),
  },
  {
    slug: "WHATSAPP_UPLOAD_MEDIA",
    description:
      "Upload media to WhatsApp for use in messages. Requires user approval before it runs.",
    parameters: z
      .object({
        file_url: z.string().describe("Public URL of the media file to upload"),
        mime_type: z.string().describe("MIME type (e.g. 'image/jpeg', 'image/png', 'video/mp4', 'audio/ogg')"),
        phone_number_id: z.string().describe("Your WhatsApp Business phone number ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Upload WhatsApp media",
      preview: `Upload ${String(a["mime_type"] ?? "")} from ${String(a["file_url"] ?? "").slice(0, 200)}`,
      confirmText: "Upload media",
    }),
  },
  {
    slug: "WHATSAPP_DELETE_MEDIA",
    description:
      "Delete a WhatsApp media file. Requires user approval before it runs.",
    parameters: z
      .object({
        media_id: z.string().describe("WhatsApp media ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete WhatsApp media",
      preview: `Delete media ${String(a["media_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete media",
    }),
  },
]

export function makeComposioWhatsAppDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "whatsapp",
    name: "WhatsApp",
    category: "communication",
    icon: "whatsapp",
    description: "Send messages, manage media, and view business account info via WhatsApp Business API (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: WHATSAPP_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_WHATSAPP_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Set up a WhatsApp Business Account (WABA) in Meta Developer Portal",
        "Create a custom auth config in Composio with your Meta app credentials and WABA ID",
        "Set COMPOSIO_API_KEY and COMPOSIO_WHATSAPP_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=whatsapp to route WhatsApp through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_WHATSAPP_AUTH_CONFIG_ID", label: "Composio WhatsApp auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/whatsapp",
    },
    tools: createComposioTools({
      provider: "whatsapp",
      toolkit: WHATSAPP_TOOLKIT,
      specs: whatsappComposioSpecs,
      executor,
    }),
  }
}
