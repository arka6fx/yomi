import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

export function createCalendarTools(ctx: ConnectorContext): ToolSet {
  async function calendar<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "google-calendar")
    const base = "https://www.googleapis.com/calendar/v3"
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Calendar API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    // DELETE and some writes return 204 No Content — don't try to parse JSON.
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/

  async function userTimeZone(): Promise<string | null> {
    try {
      const data = await calendar<{ value?: string }>("/users/me/settings/timezone")
      return data.value ?? null
    } catch {
      return null
    }
  }

  // Google interprets an offset-less dateTime via the accompanying timeZone
  // field. The model rarely knows the user's UTC offset (it used to guess UTC
  // and put 9 PM meetings at 2:30 AM local), so offset-less times are anchored
  // to the user's own calendar timezone here.
  async function eventTime(dateTime: string): Promise<{ dateTime: string; timeZone?: string }> {
    if (HAS_OFFSET.test(dateTime)) return { dateTime }
    const tz = await userTimeZone()
    return tz ? { dateTime, timeZone: tz } : { dateTime }
  }

  const LOCAL_TIME_HINT =
    "Pass the user's local wall-clock time WITHOUT a UTC offset (e.g. 2026-07-01T14:00:00) — it is interpreted in the user's own calendar timezone automatically. Never convert to UTC or assume a timezone; only include an explicit offset if the user names one."

  return {
    "calendar-listEvents": tool({
      description:
        "List upcoming calendar events. Returns events from the user's primary Google Calendar within the specified time range.",
      parameters: z.object({
        days: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(7)
          .describe("Number of days ahead to look (default: 7)"),
        maxResults: z.number().int().min(1).max(50).default(20).describe("Max events to return"),
      }),
      execute: async ({ days, maxResults }) => {
        try {
          const now = new Date()
          const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
          const params = new URLSearchParams({
            timeMin: now.toISOString(),
            timeMax: end.toISOString(),
            maxResults: String(maxResults),
            singleEvents: "true",
            orderBy: "startTime",
          })
          const data = await calendar<{
            items?: {
              id: string
              summary?: string
              start?: { dateTime?: string; date?: string }
              end?: { dateTime?: string; date?: string }
              location?: string
              description?: string
              htmlLink?: string
            }[]
          }>(`/calendars/primary/events?${params}`)
          const events = (data.items ?? []).map((e) => ({
            id: e.id,
            title: e.summary ?? "(No title)",
            start: e.start?.dateTime ?? e.start?.date ?? "",
            end: e.end?.dateTime ?? e.end?.date ?? "",
            location: e.location,
            description: e.description?.slice(0, 500),
          }))
          if (events.length === 0)
            return { events: [], message: "No events found in this time range." }
          return { count: events.length, events }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "calendar-getEvent": tool({
      description: "Get details for a specific calendar event by its ID.",
      parameters: z.object({
        eventId: z.string().describe("Google Calendar event ID"),
      }),
      execute: async ({ eventId }) => {
        try {
          const event = await calendar<{
            id: string
            summary?: string
            start?: { dateTime?: string; date?: string }
            end?: { dateTime?: string; date?: string }
            location?: string
            description?: string
            attendees?: { email: string; displayName?: string; responseStatus?: string }[]
            htmlLink?: string
          }>(`/calendars/primary/events/${encodeURIComponent(eventId)}`)
          return {
            id: event.id,
            title: event.summary ?? "(No title)",
            start: event.start?.dateTime ?? event.start?.date ?? "",
            end: event.end?.dateTime ?? event.end?.date ?? "",
            location: event.location,
            description: event.description,
            attendees: event.attendees?.map((a) => ({
              email: a.email,
              name: a.displayName,
              status: a.responseStatus,
            })),
            link: event.htmlLink,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "calendar-findFreeTime": tool({
      description:
        "Find free time slots in the user's calendar. Useful for scheduling. Returns busy periods and implied free windows.",
      parameters: z.object({
        date: z.string().describe("Date to check in YYYY-MM-DD format (checks 6am–10pm that day)"),
      }),
      execute: async ({ date }) => {
        try {
          const dayStart = new Date(`${date}T06:00:00`)
          const dayEnd = new Date(`${date}T22:00:00`)
          const data = await calendar<{
            calendars?: Record<string, { busy?: { start: string; end: string }[] }>
          }>("/freeBusy", {
            method: "POST",
            body: JSON.stringify({
              timeMin: dayStart.toISOString(),
              timeMax: dayEnd.toISOString(),
              items: [{ id: "primary" }],
            }),
          })
          const busy = data.calendars?.["primary"]?.busy ?? []
          return {
            date,
            workingHours: "6:00 AM – 10:00 PM",
            busySlots: busy.map((b) => ({
              start: new Date(b.start).toLocaleTimeString(),
              end: new Date(b.end).toLocaleTimeString(),
            })),
            message:
              busy.length === 0
                ? "No busy slots found — the day appears free."
                : `${busy.length} busy slot(s) found.`,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "calendar-createEvent": tool({
      description: `Create a new event on the user's primary Google Calendar. ${LOCAL_TIME_HINT} Confirm the details with the user before creating.`,
      parameters: z.object({
        title: z.string().describe("Event title / summary"),
        start: z
          .string()
          .describe("Start datetime in the user's local time, e.g. 2026-07-01T14:00:00 (no offset)"),
        end: z.string().describe("End datetime in the user's local time (no offset)"),
        description: z.string().optional().describe("Event description / notes"),
        location: z.string().optional().describe("Event location"),
        attendees: z.array(z.string()).optional().describe("Attendee email addresses to invite"),
      }),
      execute: async (args) => {
        const { title, start, end, description, location, attendees } = args
        return gateWrite(
          ctx,
          {
            connector: "google-calendar",
            action: "calendar-createEvent",
            risk: "write",
            title: `Create calendar event: ${title}`,
            preview: `${title}\n${start} – ${end}${attendees?.length ? `\nAttendees: ${attendees.join(", ")}` : ""}${location ? `\nLocation: ${location}` : ""}`,
            confirmText: "Create event",
          },
          args,
          async () => {
            try {
              const event = await calendar<{ id: string; htmlLink?: string }>(
                "/calendars/primary/events",
                {
                  method: "POST",
                  body: JSON.stringify({
                    summary: title,
                    start: await eventTime(start),
                    end: await eventTime(end),
                    description,
                    location,
                    attendees: attendees?.map((email) => ({ email })),
                  }),
                },
              )
              return {
                ok: true,
                eventId: event.id,
                link: event.htmlLink,
                message: `Event "${title}" created.`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "calendar-updateEvent": tool({
      description:
        "Update an existing calendar event. Only the fields you pass are changed. Get the eventId from calendar-listEvents first, and confirm the changes with the user.",
      parameters: z.object({
        eventId: z.string().describe("Google Calendar event ID to update"),
        title: z.string().optional().describe("New title / summary"),
        start: z.string().optional().describe("New start datetime in the user's local time (no offset)"),
        end: z.string().optional().describe("New end datetime in the user's local time (no offset)"),
        description: z.string().optional().describe("New description"),
        location: z.string().optional().describe("New location"),
      }),
      execute: async (args) => {
        const { eventId, title, start, end, description, location } = args
        return gateWrite(
          ctx,
          {
            connector: "google-calendar",
            action: "calendar-updateEvent",
            risk: "write",
            title: `Update calendar event ${eventId}`,
            preview: [
              title ? `Title: ${title}` : null,
              start ? `Start: ${start}` : null,
              end ? `End: ${end}` : null,
              location ? `Location: ${location}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            confirmText: "Update event",
          },
          args,
          async () => {
            try {
              const patch: Record<string, unknown> = {}
              if (title !== undefined) patch["summary"] = title
              if (start !== undefined) patch["start"] = await eventTime(start)
              if (end !== undefined) patch["end"] = await eventTime(end)
              if (description !== undefined) patch["description"] = description
              if (location !== undefined) patch["location"] = location
              const event = await calendar<{ id: string; htmlLink?: string }>(
                `/calendars/primary/events/${encodeURIComponent(eventId)}`,
                { method: "PATCH", body: JSON.stringify(patch) },
              )
              return {
                ok: true,
                eventId: event.id,
                link: event.htmlLink,
                message: "Event updated.",
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "calendar-deleteEvent": tool({
      description:
        "Delete a calendar event by ID. IMPORTANT: Always confirm with the user before calling this — the event is removed from the calendar.",
      parameters: z.object({
        eventId: z.string().describe("Google Calendar event ID to delete"),
      }),
      execute: async (args) => {
        const { eventId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-calendar",
            action: "calendar-deleteEvent",
            risk: "irreversible",
            title: `Delete calendar event ${eventId}`,
            preview: `Delete event ${eventId}`,
            confirmText: "Delete event",
          },
          args,
          async () => {
            try {
              await calendar(`/calendars/primary/events/${encodeURIComponent(eventId)}`, {
                method: "DELETE",
              })
              return { ok: true, message: `Event ${eventId} deleted.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "calendar-listCalendars": tool({
      description:
        "List all calendars the user has access to, including the primary calendar and any secondary calendars they've created or subscribed to.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const data = await calendar<{
            items?: {
              id: string
              summary?: string
              description?: string
              primary?: boolean
              backgroundColor?: string
            }[]
          }>(`/users/me/calendarList`)
          const cals = (data.items ?? []).map((c) => ({
            id: c.id,
            name: c.summary ?? "(No title)",
            description: c.description,
            primary: c.primary ?? false,
          }))
          if (cals.length === 0) return { calendars: [], message: "No calendars found." }
          return { count: cals.length, calendars: cals }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "calendar-quickAdd": tool({
      description:
        "Quickly create a calendar event using natural language text. Google Calendar parses the text to extract title, date, time, and duration. Example: 'Lunch with Sarah tomorrow at 1pm for 1 hour'.",
      parameters: z.object({
        text: z
          .string()
          .describe(
            "Natural language event description, e.g. 'Meeting with John next Tuesday at 2pm'",
          ),
        calendarId: z.string().optional().describe("Calendar ID (defaults to primary)"),
      }),
      execute: async (args) => {
        return gateWrite(
          ctx,
          {
            connector: "google-calendar",
            action: "calendar-quickAdd",
            risk: "write",
            title: "Quick add calendar event",
            preview: args.text,
            confirmText: "Quick add",
          },
          args,
          async () => {
            try {
              const cal = args.calendarId ?? "primary"
              const event = await calendar<{ id: string; htmlLink?: string; summary?: string }>(
                `/calendars/${encodeURIComponent(cal)}/events/quickAdd?sendNotifications=true`,
                {
                  method: "POST",
                  body: JSON.stringify({ text: args.text }),
                },
              )
              return {
                ok: true,
                eventId: event.id,
                title: event.summary,
                link: event.htmlLink,
                message: `Event "${event.summary}" created.`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "calendar-getCalendar": tool({
      description:
        "Get metadata for a specific Google Calendar by ID, including its name, description, timezone, and access role.",
      parameters: z.object({
        calendarId: z.string().optional().describe("Calendar ID (defaults to primary)"),
      }),
      execute: async ({ calendarId }) => {
        try {
          const cal = calendarId ?? "primary"
          const data = await calendar<{
            id: string
            summary: string
            description?: string
            timeZone?: string
            accessRole?: string
            backgroundColor?: string
            primary?: boolean
          }>(`/calendars/${encodeURIComponent(cal)}`)
          return {
            id: data.id,
            name: data.summary,
            description: data.description ?? null,
            timezone: data.timeZone ?? null,
            accessRole: data.accessRole ?? null,
            backgroundColor: data.backgroundColor ?? null,
            primary: data.primary ?? false,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "calendar-createEventWithMeet": tool({
      description:
        `Create a new event on a Google Calendar with a Google Meet video conferencing link attached. ${LOCAL_TIME_HINT} Confirm the details with the user before creating.`,
      parameters: z.object({
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID to create the event in (defaults to primary)"),
        title: z.string().describe("Event title / summary"),
        start: z
          .string()
          .describe("Start datetime in the user's local time, e.g. 2026-07-01T14:00:00 (no offset)"),
        end: z.string().describe("End datetime in the user's local time (no offset)"),
        description: z.string().optional().describe("Event description / notes"),
        location: z.string().optional().describe("Event location"),
        attendees: z.array(z.string()).optional().describe("Attendee email addresses to invite"),
      }),
      execute: async (args) => {
        const { calendarId, title, start, end, description, location, attendees } = args
        return gateWrite(
          ctx,
          {
            connector: "google-calendar",
            action: "calendar-createEventWithMeet",
            risk: "write",
            title: `Create calendar event with Meet: ${title}`,
            preview: `${title}\n${start} – ${end}\nGoogle Meet video conferencing${attendees?.length ? `\nAttendees: ${attendees.join(", ")}` : ""}${location ? `\nLocation: ${location}` : ""}`,
            confirmText: "Create event with Meet",
          },
          args,
          async () => {
            try {
              const cal = calendarId ?? "primary"
              const event = await calendar<{
                id: string
                htmlLink?: string
                conferenceData?: { entryPoints?: { uri?: string }[] }
              }>(`/calendars/${encodeURIComponent(cal)}/events?conferenceDataVersion=1`, {
                method: "POST",
                body: JSON.stringify({
                  summary: title,
                  start: { dateTime: start },
                  end: { dateTime: end },
                  description,
                  location,
                  attendees: attendees?.map((email) => ({ email })),
                  conferenceData: {
                    createRequest: {
                      requestId: `yomi-${Date.now()}`,
                      conferenceSolutionKey: { type: "hangoutsMeet" },
                    },
                  },
                }),
              })
              const meetLink = event.conferenceData?.entryPoints?.find((e) => e.uri)?.uri ?? null
              return {
                ok: true,
                eventId: event.id,
                link: event.htmlLink,
                meetLink,
                message: `Event "${title}" created with Google Meet.`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),
  }
}

export const googleCalendarDef: ConnectorDef = {
  id: "google-calendar",
  name: "Google Calendar",
  category: "productivity",
  icon: "google-calendar",
  description:
    "View events, check availability, and create, edit, or delete events on your Google Calendar.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // Full Calendar access (read + create/edit/delete events). Sensitive scope —
      // requires Google OAuth verification for public use; test users work for personal use.
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google-calendar",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Use the same Google Cloud project as Gmail (GOOGLE_INTEGRATIONS_CLIENT_ID)",
      "Enable Google Calendar API under APIs & Services → Library",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-calendar",
      "NOTE: the full calendar scope is a sensitive scope — requires Google OAuth verification before non-owner users can connect",
    ],
    collect: [
      {
        env: "GOOGLE_INTEGRATIONS_CLIENT_ID",
        label: "Google Client ID (same as Gmail)",
        secret: false,
      },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/calendar/api/quickstart",
  },
  tools: createCalendarTools,
}
