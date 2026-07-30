import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ZOOM_TOOLKIT = "zoom"

export const zoomComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "ZOOM_GET_A_MEETING",
    description: "Get details of a specific Zoom meeting. Read-only.",
    parameters: z.object({ meetingId: z.number().int().describe("Meeting ID") }).passthrough(),
  },
  {
    slug: "ZOOM_LIST_MEETINGS",
    description: "List a user's scheduled meetings. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID, or 'me' for the authenticated user"),
        type: z.string().optional().describe("Meeting type filter"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_A_MEETING_SUMMARY",
    description: "Get the AI-generated summary of a past meeting. Read-only.",
    parameters: z.object({ meetingId: z.string().describe("Meeting ID") }).passthrough(),
  },
  {
    slug: "ZOOM_GET_A_WEBINAR",
    description: "Get details of a specific webinar. Read-only.",
    parameters: z.object({ webinarId: z.string().describe("Webinar ID") }).passthrough(),
  },
  {
    slug: "ZOOM_LIST_WEBINARS",
    description: "List scheduled webinars. Read-only.",
    parameters: z.object({ userId: z.string().describe("User ID, or 'me'") }).passthrough(),
  },
  {
    slug: "ZOOM_LIST_WEBINAR_PARTICIPANTS",
    description: "List past webinar participants. Read-only.",
    parameters: z.object({ webinarId: z.string().describe("Webinar ID") }).passthrough(),
  },
  {
    slug: "ZOOM_GET_PAST_MEETING_PARTICIPANTS",
    description: "Get attendee info for a past meeting. Read-only.",
    parameters: z.object({ meetingId: z.string().describe("Meeting ID") }).passthrough(),
  },
  {
    slug: "ZOOM_LIST_ALL_RECORDINGS",
    description: "List cloud recordings for a user. Read-only.",
    parameters: z.object({ userId: z.string().describe("User ID, or 'me'") }).passthrough(),
  },
  {
    slug: "ZOOM_GET_MEETING_RECORDINGS",
    description: "Get recordings for a specific meeting. Read-only.",
    parameters: z.object({ meetingId: z.string().describe("Meeting ID") }).passthrough(),
  },
  {
    slug: "ZOOM_LIST_ARCHIVED_FILES",
    description: "List archived meeting/webinar files. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "ZOOM_GET_DAILY_USAGE_REPORT",
    description: "Get the daily Zoom account usage report. Read-only.",
    parameters: z
      .object({
        year: z.number().int().optional().describe("Year"),
        month: z.number().int().optional().describe("Month"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_DEVICES",
    description: "List Zoom Rooms devices. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "ZOOM_CREATE_A_MEETING",
    description: "Create a new Zoom meeting. Requires user approval before it runs.",
    parameters: z
      .object({
        userId: z.string().describe("User ID, or 'me'"),
        topic: z.string().optional().describe("Meeting topic"),
        start_time: z.string().optional().describe("Start time (ISO 8601)"),
        duration: z.number().int().optional().describe("Duration in minutes"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create meeting",
      preview: `Create meeting "${String(a["topic"] ?? "")}"`,
      confirmText: "Create meeting",
    }),
  },
  {
    slug: "ZOOM_UPDATE_A_MEETING",
    description: "Update an existing Zoom meeting. Requires user approval before it runs.",
    parameters: z.object({ meetingId: z.number().int().describe("Meeting ID") }).passthrough(),
    preview: (a) => ({
      title: "Update meeting",
      preview: `Update meeting ${String(a["meetingId"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "ZOOM_ADD_A_MEETING_REGISTRANT",
    description: "Register an attendee for a meeting. Requires user approval before it runs.",
    parameters: z
      .object({
        meetingId: z.number().int().describe("Meeting ID"),
        email: z.string().describe("Registrant email"),
        first_name: z.string().describe("Registrant first name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add registrant",
      preview: `Register ${String(a["email"] ?? "")}`,
      confirmText: "Register",
    }),
  },
  {
    slug: "ZOOM_ADD_A_WEBINAR_REGISTRANT",
    description: "Register an attendee for a webinar. Requires user approval before it runs.",
    parameters: z
      .object({
        webinarId: z.number().int().describe("Webinar ID"),
        email: z.string().describe("Registrant email"),
        first_name: z.string().describe("Registrant first name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add webinar registrant",
      preview: `Register ${String(a["email"] ?? "")}`,
      confirmText: "Register",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "ZOOM_DELETE_MEETING_RECORDINGS",
    description: "Delete all recordings for a meeting. This cannot be undone.",
    parameters: z.object({ meetingId: z.string().describe("Meeting ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete recordings",
      preview: `Delete recordings for meeting ${String(a["meetingId"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioZoomDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "zoom",
    name: "Zoom",
    category: "meetings",
    icon: "zoom",
    description: "Schedule and manage Zoom meetings, webinars, and recordings (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ZOOM_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ZOOM_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Zoom auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ZOOM_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=zoom to route Zoom through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_ZOOM_AUTH_CONFIG_ID",
          label: "Composio Zoom auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/zoom",
    },
    tools: createComposioTools({
      provider: "zoom",
      toolkit: ZOOM_TOOLKIT,
      specs: zoomComposioSpecs,
      executor,
    }),
  }
}
