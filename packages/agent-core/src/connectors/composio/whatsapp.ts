import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const WHATSAPP_TOOLKIT = "whatsapp"

export const whatsappComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "WHATSAPP_GET_PHONE_NUMBERS", description: "List phone numbers on the WhatsApp Business account. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "WHATSAPP_GET_PHONE_NUMBER", description: "Get details of a specific phone number. Read-only.", parameters: z.object({ phone_number_id: z.string().describe("Phone number ID") }).passthrough() },
  { slug: "WHATSAPP_GET_BUSINESS_PROFILE", description: "Get the business profile for a phone number. Read-only.", parameters: z.object({ phone_number_id: z.string().describe("Phone number ID") }).passthrough() },
  { slug: "WHATSAPP_GET_MESSAGE_TEMPLATES", description: "List message templates. Read-only.", parameters: z.object({ status: z.string().optional().describe("Filter by approval status") }).passthrough() },
  { slug: "WHATSAPP_GET_TEMPLATE_STATUS", description: "Get the approval status of a message template. Read-only.", parameters: z.object({ template_id: z.string().describe("Template ID") }).passthrough() },
  { slug: "WHATSAPP_GET_MEDIA", description: "Get uploaded media info including a temporary download URL. Read-only.", parameters: z.object({ media_id: z.string().describe("Media ID") }).passthrough() },
  { slug: "WHATSAPP_GET_MEDIA_INFO", description: "Get metadata about uploaded media, without a download URL. Read-only.", parameters: z.object({ media_id: z.string().describe("Media ID") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "WHATSAPP_SEND_MESSAGE",
    description: "Send a text message to a WhatsApp number. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), text: z.string().describe("Message text") }).passthrough(),
    preview: (a) => ({ title: "Send message", preview: String(a["text"] ?? "").slice(0, 100), confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_REPLY",
    description: "Reply to a specific message in a conversation. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), text: z.string().describe("Reply text"), reply_to_message_id: z.string().describe("Message ID being replied to") }).passthrough(),
    preview: (a) => ({ title: "Send reply", preview: String(a["text"] ?? "").slice(0, 100), confirmText: "Reply" }),
  },
  {
    slug: "WHATSAPP_SEND_MEDIA",
    description: "Send a media message (image/video/document) via URL. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), media_type: z.string().describe("'image', 'video', 'document', or 'audio'"), link: z.string().describe("Media URL"), caption: z.string().optional().describe("Caption") }).passthrough(),
    preview: (a) => ({ title: "Send media", preview: `Send ${String(a["media_type"] ?? "media")} to ${String(a["to_number"] ?? "")}`, confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_MEDIA_BY_ID",
    description: "Send previously uploaded media by its media ID. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), media_id: z.string().describe("Uploaded media ID"), media_type: z.string().describe("Media type") }).passthrough(),
    preview: (a) => ({ title: "Send media", preview: `Send media ${String(a["media_id"] ?? "")}`, confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_LOCATION",
    description: "Send a location message. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), name: z.string().describe("Location name"), address: z.string().describe("Address"), latitude: z.string().describe("Latitude"), longitude: z.string().describe("Longitude") }).passthrough(),
    preview: (a) => ({ title: "Send location", preview: `Send location "${String(a["name"] ?? "")}"`, confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_CONTACTS",
    description: "Send a contact card message. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), contacts: z.array(z.record(z.string(), z.unknown())).describe("Contact cards to send") }).passthrough(),
    preview: (a) => ({ title: "Send contacts", preview: `Send contacts to ${String(a["to_number"] ?? "")}`, confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_INTERACTIVE_BUTTONS",
    description: "Send an interactive button message. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), body_text: z.string().describe("Message body"), buttons: z.array(z.record(z.string(), z.unknown())).describe("Button definitions") }).passthrough(),
    preview: (a) => ({ title: "Send buttons", preview: String(a["body_text"] ?? "").slice(0, 100), confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_INTERACTIVE_LIST",
    description: "Send an interactive list message. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), body_text: z.string().describe("Message body"), button_text: z.string().describe("List button label"), sections: z.array(z.record(z.string(), z.unknown())).describe("List sections/items") }).passthrough(),
    preview: (a) => ({ title: "Send list", preview: String(a["body_text"] ?? "").slice(0, 100), confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_SEND_TEMPLATE_MESSAGE",
    description: "Send a pre-approved template message. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Sending phone number ID"), to_number: z.string().describe("Recipient number"), template_name: z.string().describe("Template name") }).passthrough(),
    preview: (a) => ({ title: "Send template", preview: `Send template "${String(a["template_name"] ?? "")}"`, confirmText: "Send" }),
  },
  {
    slug: "WHATSAPP_UPLOAD_MEDIA",
    description: "Upload media to WhatsApp servers for later sending. Requires user approval before it runs.",
    parameters: z.object({ phone_number_id: z.string().describe("Phone number ID"), media_type: z.string().describe("Media type") }).passthrough(),
    preview: () => ({ title: "Upload media", preview: "Upload media to WhatsApp", confirmText: "Upload" }),
  },
  {
    slug: "WHATSAPP_CREATE_MESSAGE_TEMPLATE",
    description: "Create a new message template (requires Meta approval before use). Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Template name"), category: z.string().describe("Template category"), language: z.string().describe("Language code") }).passthrough(),
    preview: (a) => ({ title: "Create template", preview: `Create template "${String(a["name"] ?? "")}"`, confirmText: "Create" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "WHATSAPP_DELETE_MESSAGE_TEMPLATE",
    description: "Permanently delete a message template. This cannot be undone.",
    parameters: z.object({ template_id: z.string().describe("Template ID") }).passthrough(),
    preview: (a) => ({ title: "Delete template", preview: `Delete template ${String(a["template_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioWhatsAppDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "whatsapp",
    name: "WhatsApp",
    category: "communication",
    icon: "whatsapp",
    description: "WhatsApp Business — send messages, media, templates, and interactive messages (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: WHATSAPP_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_WHATSAPP_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a WhatsApp Business auth config in Composio",
        "Set COMPOSIO_API_KEY and COMPOSIO_WHATSAPP_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=whatsapp to route WhatsApp through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_WHATSAPP_AUTH_CONFIG_ID", label: "Composio WhatsApp auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/whatsapp",
    },
    tools: createComposioTools({
      provider: "whatsapp",
      toolkit: WHATSAPP_TOOLKIT,
      specs: whatsappComposioSpecs,
      executor,
    }),
  }
}
