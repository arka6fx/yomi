import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CALENDAR_TOOLKIT = "googlecalendar"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googlecalendar) — the original set had 4
// hallucinated slugs (LIST_EVENTS, GET_EVENT, GET_FREE_BUSY, QUICK_ADD_EVENT
// don't exist; real are EVENTS_LIST, FIND_EVENT, FREE_BUSY_QUERY, QUICK_ADD)
// and, worse, CREATE_EVENT/UPDATE_EVENT kept their real slugs but every param
// was invented (title/start_time/end_time vs the real API's summary/
// start_datetime/event_duration_hour+minutes). There is no "get event by id"
// action in this toolkit at all — FIND_EVENT is search-only.
export const calendarComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLECALENDAR_EVENTS_LIST",
    description:
      "List events on a calendar within a time range, sorted by start time. Read-only.",
    parameters: z
      .object({
        calendarId: z.string().describe("Calendar ID, or 'primary' for the user's main calendar"),
        timeMin: z.string().optional().describe("RFC3339 lower bound for event end time, e.g. 2024-06-03T10:00:00-07:00"),
        timeMax: z.string().optional().describe("RFC3339 upper bound for event start time"),
        maxResults: z.number().int().min(1).max(2500).optional().describe("Max events per page (default 250)"),
        q: z.string().optional().describe("Free-text search across event fields"),
        singleEvents: z.boolean().optional().describe("Expand recurring events into individual instances"),
        orderBy: z.enum(["startTime", "updated"]).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECALENDAR_FIND_EVENT",
    description:
      "Search for events by text query across summary, description, location, and attendees. There is no separate " +
      "'get event by ID' action — use this or GOOGLECALENDAR_EVENTS_LIST to find the event_id needed by update/delete. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Free-text search terms"),
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        timeMin: z.string().optional().describe("RFC3339 or 'YYYY-MM-DD HH:MM:SS' lower bound"),
        timeMax: z.string().optional().describe("RFC3339 or 'YYYY-MM-DD HH:MM:SS' upper bound"),
        max_results: z.number().int().optional().describe("Max results per page (default 10)"),
        single_events: z.boolean().optional().describe("Expand recurring events into individual instances (default true)"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECALENDAR_LIST_CALENDARS",
    description: "List all calendars the user has access to, including primary and secondary calendars. Read-only.",
    parameters: z
      .object({
        max_results: z.number().int().max(250).optional().describe("Max calendars per page (default 10)"),
        show_hidden: z.boolean().optional(),
        min_access_role: z.enum(["freeBusyReader", "owner", "reader", "writer"]).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECALENDAR_FREE_BUSY_QUERY",
    description: "Check availability — returns busy time slots for one or more calendars over a time range. Read-only.",
    parameters: z
      .object({
        timeMin: z.string().describe("RFC3339 start of the interval to query"),
        timeMax: z.string().describe("RFC3339 end of the interval to query"),
        items: z
          .array(z.object({ id: z.string().describe("Calendar or group ID") }).passthrough())
          .describe("Calendars/groups to query, e.g. [{ id: 'primary' }]"),
        timeZone: z.string().optional().describe("Time zone for the response (defaults to UTC)"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLECALENDAR_CREATE_EVENT",
    description:
      "Create a new event on a Google Calendar. Duration is set via event_duration_hour/event_duration_minutes, not an " +
      "end time — event_duration_minutes must stay under 60 (use event_duration_hour=1 for a 1-hour event, not minutes=60). " +
      "Requires user approval before it runs.",
    parameters: z
      .object({
        start_datetime: z
          .string()
          .describe("Naive local date/time with NO offset or Z, e.g. '2025-01-16T13:00:00'"),
        summary: z.string().optional().describe("Event title"),
        description: z.string().optional().describe("Event description (can contain HTML)"),
        location: z.string().optional(),
        timezone: z.string().optional().describe("IANA timezone, e.g. 'America/New_York' (required if start_datetime is naive with no offset)"),
        calendar_id: z.string().optional().describe("Calendar ID (defaults to 'primary')"),
        attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
        event_duration_hour: z.number().int().min(0).max(24).optional().describe("Duration hours component (0-24)"),
        event_duration_minutes: z.number().int().min(0).max(59).optional().describe("Duration minutes component (0-59 ONLY — never 60+)"),
        send_updates: z.boolean().optional().describe("Whether to email attendees about the new event (default true)"),
        recurrence: z.array(z.string()).optional().describe("RRULE/EXRULE/RDATE/EXDATE lines for recurring events"),
        visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create calendar event: ${String(a["summary"] ?? "")}`,
      preview: `${String(a["summary"] ?? "")}\n${String(a["start_datetime"] ?? "")}${a["event_duration_hour"] || a["event_duration_minutes"] ? ` (${String(a["event_duration_hour"] ?? 0)}h ${String(a["event_duration_minutes"] ?? 0)}m)` : ""}${(a["attendees"] as string[])?.length ? `\nAttendees: ${(a["attendees"] as string[]).join(", ")}` : ""}${a["location"] ? `\nLocation: ${String(a["location"])}` : ""}`,
      confirmText: "Create event",
    }),
  },
  {
    slug: "GOOGLECALENDAR_QUICK_ADD",
    description:
      "Quickly create a calendar event using natural language text. Google parses the text to extract title, date, time, and duration. Requires user approval before it runs.",
    parameters: z
      .object({
        text: z.string().describe("Natural language event description, e.g. 'Meeting with John next Tuesday at 2pm'"),
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        send_updates: z.enum(["all", "externalOnly", "none"]).optional(),
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
      "Update an existing calendar event. start_datetime is always required by the API even when unchanged — read the " +
      "event's current time first if only changing other fields. Requires user approval before it runs.",
    parameters: z
      .object({
        event_id: z.string().describe("Google Calendar event ID to update"),
        start_datetime: z.string().describe("Naive local date/time with NO offset or Z, e.g. '2025-01-16T13:00:00'"),
        summary: z.string().optional().describe("New title"),
        description: z.string().optional(),
        location: z.string().optional(),
        timezone: z.string().optional(),
        calendar_id: z.string().optional().describe("Calendar ID (defaults to 'primary')"),
        attendees: z.array(z.string()).optional(),
        event_duration_hour: z.number().int().min(0).max(24).optional(),
        event_duration_minutes: z.number().int().min(0).max(59).optional(),
        send_updates: z.boolean().optional(),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update calendar event ${String(a["event_id"] ?? "").slice(0, 12)}`,
      preview: [
        a["summary"] ? `Title: ${String(a["summary"])}` : null,
        a["start_datetime"] ? `Start: ${String(a["start_datetime"])}` : null,
        a["location"] ? `Location: ${String(a["location"])}` : null,
      ].filter(Boolean).join("\n") || "Update event details",
      confirmText: "Update event",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLECALENDAR_DELETE_EVENT",
    description: "Delete a calendar event by its ID. This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        event_id: z.string().describe("Google Calendar event ID to delete"),
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
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
