import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CALENDLY_TOOLKIT = "calendly"

export const calendlyComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "CALENDLY_GET_CURRENT_USER", description: "Get the authenticated Calendly user's info. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "CALENDLY_GET_USER", description: "Get details of a specific Calendly user. Read-only.", parameters: z.object({ uuid: z.string().describe("User UUID") }).passthrough() },
  { slug: "CALENDLY_LIST_EVENTS", description: "List scheduled events for a user, org, or group. Read-only.", parameters: z.object({ user: z.string().optional().describe("User URI"), organization: z.string().optional().describe("Organization URI"), status: z.string().optional().describe("Filter by status") }).passthrough() },
  { slug: "CALENDLY_GET_EVENT", description: "Get details of a specific scheduled event. Read-only.", parameters: z.object({ uuid: z.string().describe("Event UUID") }).passthrough() },
  { slug: "CALENDLY_LIST_EVENT_INVITEES", description: "List invitees for a scheduled event. Read-only.", parameters: z.object({ uuid: z.string().describe("Event UUID") }).passthrough() },
  { slug: "CALENDLY_GET_EVENT_INVITEE", description: "Get details of a specific event invitee. Read-only.", parameters: z.object({ event_uuid: z.string().describe("Event UUID"), invitee_uuid: z.string().describe("Invitee UUID") }).passthrough() },
  { slug: "CALENDLY_LIST_USER_S_EVENT_TYPES", description: "List event types for a user or organization. Read-only.", parameters: z.object({ user: z.string().optional().describe("User URI"), organization: z.string().optional().describe("Organization URI") }).passthrough() },
  { slug: "CALENDLY_GET_EVENT_TYPE", description: "Get details of a specific event type. Read-only.", parameters: z.object({ uuid: z.string().describe("Event type UUID") }).passthrough() },
  { slug: "CALENDLY_LIST_EVENT_TYPE_AVAILABLE_TIMES", description: "Get available time slots for an event type within a range. Read-only.", parameters: z.object({ event_type: z.string().describe("Event type URI"), start_time: z.string().describe("Range start (ISO 8601)"), end_time: z.string().describe("Range end (ISO 8601)") }).passthrough() },
  { slug: "CALENDLY_LIST_USER_BUSY_TIMES", description: "Get a user's busy time intervals. Read-only.", parameters: z.object({ user: z.string().describe("User URI"), start_time: z.string().describe("Range start (ISO 8601)"), end_time: z.string().describe("Range end (ISO 8601)") }).passthrough() },
  { slug: "CALENDLY_LIST_USER_AVAILABILITY_SCHEDULES", description: "List a user's availability schedules. Read-only.", parameters: z.object({ user: z.string().describe("User URI") }).passthrough() },
  { slug: "CALENDLY_LIST_ORGANIZATION_MEMBERSHIPS", description: "List organization memberships. Read-only.", parameters: z.object({ organization: z.string().optional().describe("Organization URI") }).passthrough() },
  { slug: "CALENDLY_LIST_WEBHOOK_SUBSCRIPTIONS", description: "List webhook subscriptions for an organization. Read-only.", parameters: z.object({ organization: z.string().describe("Organization URI"), scope: z.string().describe("'organization' or 'user'") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "CALENDLY_CREATE_SCHEDULING_LINK",
    description: "Create a single-use scheduling link for an event type. Requires user approval before it runs.",
    parameters: z.object({ owner: z.string().describe("Event type URI"), max_event_count: z.number().int().describe("Number of times the link can be used") }).passthrough(),
    preview: (a) => ({ title: "Create scheduling link", preview: `Create link for ${String(a["owner"] ?? "")}`, confirmText: "Create link" }),
  },
  {
    slug: "CALENDLY_CREATE_ONE_OFF_EVENT_TYPE",
    description: "Create a temporary one-off event type for a unique meeting. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Event name"), host: z.string().describe("Host user URI"), duration: z.number().int().describe("Duration in minutes") }).passthrough(),
    preview: (a) => ({ title: "Create event type", preview: `Create "${String(a["name"] ?? "")}"`, confirmText: "Create" }),
  },
  {
    slug: "CALENDLY_CREATE_WEBHOOK_SUBSCRIPTION",
    description: "Create a webhook subscription for Calendly events. Requires user approval before it runs.",
    parameters: z.object({ url: z.string().describe("Webhook callback URL"), events: z.array(z.string()).describe("Event types to subscribe to"), scope: z.string().describe("'organization' or 'user'") }).passthrough(),
    preview: (a) => ({ title: "Create webhook", preview: `Subscribe ${String(a["url"] ?? "")}`, confirmText: "Create webhook" }),
  },
  {
    slug: "CALENDLY_INVITE_USER_TO_ORGANIZATION",
    description: "Invite a user to the organization by email. Requires user approval before it runs.",
    parameters: z.object({ uuid: z.string().describe("Organization UUID"), email: z.string().describe("Invitee email") }).passthrough(),
    preview: (a) => ({ title: "Invite user", preview: `Invite ${String(a["email"] ?? "")}`, confirmText: "Invite" }),
  },
  {
    slug: "CALENDLY_CREATE_INVITEE_NO_SHOW",
    description: "Mark an invitee as a no-show for a scheduled event. Requires user approval before it runs.",
    parameters: z.object({ invitee: z.string().describe("Invitee URI") }).passthrough(),
    preview: (a) => ({ title: "Mark no-show", preview: `Mark ${String(a["invitee"] ?? "")} as no-show`, confirmText: "Mark no-show" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "CALENDLY_CANCEL_EVENT",
    description: "Permanently cancel a scheduled event. This cannot be undone.",
    parameters: z.object({ uuid: z.string().describe("Event UUID"), reason: z.string().optional().describe("Cancellation reason") }).passthrough(),
    preview: (a) => ({ title: "Cancel event", preview: `Cancel event ${String(a["uuid"] ?? "")} — this cannot be undone`, confirmText: "Cancel event" }),
  },
  {
    slug: "CALENDLY_DELETE_WEBHOOK_SUBSCRIPTION",
    description: "Delete a webhook subscription. This cannot be undone.",
    parameters: z.object({ webhook_uuid: z.string().describe("Webhook UUID") }).passthrough(),
    preview: (a) => ({ title: "Delete webhook", preview: `Delete webhook ${String(a["webhook_uuid"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "CALENDLY_REMOVE_USER_FROM_ORGANIZATION",
    description: "Remove a user from the organization. This cannot be undone.",
    parameters: z.object({ uuid: z.string().describe("Membership UUID") }).passthrough(),
    preview: (a) => ({ title: "Remove user", preview: `Remove membership ${String(a["uuid"] ?? "")} — this cannot be undone`, confirmText: "Remove" }),
  },
]

export function makeComposioCalendlyDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "calendly",
    name: "Calendly",
    category: "meetings",
    icon: "calendly",
    description: "Calendly — view scheduled events, availability, and event types; create scheduling links (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: CALENDLY_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CALENDLY_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Calendly auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_CALENDLY_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=calendly to route Calendly through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_CALENDLY_AUTH_CONFIG_ID", label: "Composio Calendly auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/calendly",
    },
    tools: createComposioTools({
      provider: "calendly",
      toolkit: CALENDLY_TOOLKIT,
      specs: calendlyComposioSpecs,
      executor,
    }),
  }
}
