import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"

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
    return res.json() as Promise<T>
  }

  return {
    "calendar.listEvents": tool({
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
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max events to return"),
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
          if (events.length === 0) return { events: [], message: "No events found in this time range." }
          return { count: events.length, events }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch events" }
        }
      },
    }),

    "calendar.getEvent": tool({
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
          return { error: err instanceof Error ? err.message : "Failed to fetch event" }
        }
      },
    }),

    "calendar.findFreeTime": tool({
      description:
        "Find free time slots in the user's calendar. Useful for scheduling. Returns busy periods and implied free windows.",
      parameters: z.object({
        date: z
          .string()
          .describe("Date to check in YYYY-MM-DD format (checks 6am–10pm that day)"),
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
          return { error: err instanceof Error ? err.message : "Failed to check availability" }
        }
      },
    }),
  }
}

export const googleCalendarDef: ConnectorDef = {
  id: "google-calendar",
  name: "Google Calendar",
  category: "productivity",
  icon: "google-calendar",
  description: "View events, check availability, and manage your Google Calendar.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
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
      "NOTE: calendar.readonly is a sensitive scope — requires Google OAuth verification before non-owner users can connect",
    ],
    collect: [
      { env: "GOOGLE_INTEGRATIONS_CLIENT_ID", label: "Google Client ID (same as Gmail)", secret: false },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/calendar/api/quickstart",
  },
  tools: createCalendarTools,
}
