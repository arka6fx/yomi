import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CALENDAR_TOOLKIT = "googlecalendar"

export const calendarComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLECALENDAR_LIST_EVENTS",
    description:
      "List upcoming calendar events from the user's primary Google Calendar within a time range. Optionally filter by calendar ID. Read-only.",
    parameters: z
      .object({
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        max_results: z.number().int().min(1).max(100).optional().describe("Max events to return"),
        time_min: z.string().optional().describe("Start time in ISO 8601 format"),
        time_max: z.string().optional().describe("End time in ISO 8601 format"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECALENDAR_GET_EVENT",
    description:
      "Get full details for a specific calendar event by its ID. Read-only.",
    parameters: z
      .object({
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        event_id: z.string().describe("Google Calendar event ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECALENDAR_LIST_CALENDARS",
    description:
      "List all calendars the user has access to, including primary and secondary calendars. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GOOGLECALENDAR_GET_FREE_BUSY",
    description:
      "Check availability — returns busy time slots for a date range. Useful for finding free time to schedule. Read-only.",
    parameters: z
      .object({
        time_min: z.string().describe("Start time in ISO 8601 format"),
        time_max: z.string().describe("End time in ISO 8601 format"),
        calendar_ids: z.array(z.string()).optional().describe("Calendar IDs to check (defaults to primary)"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLECALENDAR_CREATE_EVENT",
    description:
      "Create a new event on the user's Google Calendar. Optionally add attendees and a location. Requires user approval before it runs.",
    parameters: z
      .object({
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        title: z.string().describe("Event title / summary"),
        start_time: z.string().describe("Start datetime in ISO 8601 format"),
        end_time: z.string().describe("End datetime in ISO 8601 format"),
        description: z.string().optional().describe("Event description / notes"),
        location: z.string().optional().describe("Event location"),
        attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create calendar event: ${String(a["title"] ?? "")}`,
      preview: `${String(a["title"] ?? "")}\n${String(a["start_time"] ?? "")} – ${String(a["end_time"] ?? "")}${(a["attendees"] as string[])?.length ? `\nAttendees: ${(a["attendees"] as string[]).join(", ")}` : ""}${a["location"] ? `\nLocation: ${String(a["location"])}` : ""}`,
      confirmText: "Create event",
    }),
  },
  {
    slug: "GOOGLECALENDAR_QUICK_ADD_EVENT",
    description:
      "Quickly create a calendar event using natural language text. Google parses the text to extract title, date, time, and duration. Requires user approval before it runs.",
    parameters: z
      .object({
        text: z.string().describe("Natural language event description, e.g. 'Meeting with John next Tuesday at 2pm'"),
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Quick add calendar event",
      preview: String(a["text"] ?? ""),
      confirmText: "Quick add",
    }),
  },
  {
    slug: "GOOGLECALENDAR_UPDATE_EVENT",
    description:
      "Update an existing calendar event. Only the fields you pass are changed. Requires user approval before it runs.",
    parameters: z
      .object({
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        event_id: z.string().describe("Google Calendar event ID to update"),
        title: z.string().optional().describe("New title"),
        start_time: z.string().optional().describe("New start datetime"),
        end_time: z.string().optional().describe("New end datetime"),
        description: z.string().optional().describe("New description"),
        location: z.string().optional().describe("New location"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update calendar event ${String(a["event_id"] ?? "").slice(0, 12)}`,
      preview: [
        a["title"] ? `Title: ${String(a["title"])}` : null,
        a["start_time"] ? `Start: ${String(a["start_time"])}` : null,
        a["end_time"] ? `End: ${String(a["end_time"])}` : null,
        a["location"] ? `Location: ${String(a["location"])}` : null,
      ].filter(Boolean).join("\n") || "Update event details",
      confirmText: "Update event",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLECALENDAR_DELETE_EVENT",
    description:
      "Delete a calendar event by its ID. This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        event_id: z.string().describe("Google Calendar event ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete calendar event",
      preview: `Delete event ${String(a["event_id"] ?? "").slice(0, 12)}. This CANNOT be undone.`,
      confirmText: "Delete event",
    }),
  },
]

export function makeComposioCalendarDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-calendar",
    name: "Google Calendar",
    category: "productivity",
    icon: "google-calendar",
    description: "View and manage events on your Google Calendar (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: CALENDAR_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CALENDAR_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_CALENDAR_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-calendar to route Calendar through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_CALENDAR_AUTH_CONFIG_ID", label: "Composio Calendar auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googlecalendar",
    },
    tools: createComposioTools({
      provider: "google-calendar",
      toolkit: CALENDAR_TOOLKIT,
      specs: calendarComposioSpecs,
      executor,
    }),
  }
}
