import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const MEET_TOOLKIT = "googlemeet"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googlemeet) — 5 of the original 6 slugs were
// hallucinated (GET_SPACE, GET_CONFERENCE_RECORD, GET_TRANSCRIPT, CREATE_SPACE
// don't exist; real are GET_MEET, GET_CONFERENCE_RECORD_FOR_MEET,
// GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID, CREATE_MEET). There is no
// "end active conference" action anywhere in this toolkit — dropped, not
// replaceable. Added GET_RECORDINGS_BY_CONFERENCE_RECORD_ID and the
// participant-session actions since they're real, useful, and already fully
// schema'd here.
export const meetComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLEMEET_GET_MEET",
    description: "Get details for a Google Meet space by its resource name. Read-only.",
    parameters: z
      .object({
        space_name: z.string().describe("Meet space resource name, e.g. 'spaces/jQCFfuBOdN5z'"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_LIST_CONFERENCE_RECORDS",
    description:
      "List past Google Meet conference records. Optionally filter by space, meeting code, or time range. Read-only.",
    parameters: z
      .object({
        filter: z
          .string()
          .optional()
          .describe(
            "EBNF filter, e.g. 'space.meeting_code = \"abc-mnop-xyz\"' or 'start_time>=\"2024-01-01T00:00:00.000Z\"'",
          ),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max records to return (default 25)"),
        page_token: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_GET_CONFERENCE_RECORD_FOR_MEET",
    description:
      "Look up a specific past conference record by space name, meeting code, or time range. Read-only.",
    parameters: z
      .object({
        space_name: z.string().optional().describe("Meet space resource name"),
        meeting_code: z.string().optional().describe("Meeting code of the Meet space"),
        start_time: z.string().optional(),
        end_time: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID",
    description: "Get the transcript(s) for a past Google Meet conference. Read-only.",
    parameters: z
      .object({
        conferenceRecord_id: z
          .string()
          .describe("Conference record ID, from GOOGLEMEET_LIST_CONFERENCE_RECORDS"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_GET_RECORDINGS_BY_CONFERENCE_RECORD_ID",
    description: "Get the recording(s) for a past Google Meet conference. Read-only.",
    parameters: z
      .object({
        conferenceRecord_id: z
          .string()
          .describe("Conference record ID, from GOOGLEMEET_LIST_CONFERENCE_RECORDS"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_LIST_PARTICIPANT_SESSIONS",
    description:
      "List participant sessions (who joined/left, and when) for a past conference. Read-only.",
    parameters: z
      .object({
        parent: z
          .string()
          .describe("Conference record resource name, e.g. 'conferenceRecords/my-conference-123'"),
        filter: z
          .string()
          .optional()
          .describe("EBNF filter, e.g. 'latest_end_time IS NULL' for still-active sessions"),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .describe("Max results (default 100)"),
        page_token: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_GET_PARTICIPANT_SESSION",
    description: "Get details for a single participant session. Read-only.",
    parameters: z
      .object({
        name: z
          .string()
          .describe("Resource name, e.g. 'conferenceRecords/123456789/participants/abcdefg'"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLEMEET_CREATE_MEET",
    description:
      "Create a new Google Meet space (a reusable meeting link). Requires user approval before it runs.",
    parameters: z
      .object({
        access_type: z
          .enum(["OPEN", "TRUSTED", "RESTRICTED"])
          .optional()
          .describe("Who can join without explicit invite"),
        entry_point_access: z.enum(["ALL", "CREATOR_APP_ONLY"]).optional(),
      })
      .passthrough(),
    preview: () => ({
      title: "Create a new Google Meet space",
      preview: "Create a reusable Google Meet link",
      confirmText: "Create meeting",
    }),
  },
  {
    slug: "GOOGLEMEET_UPDATE_SPACE",
    description:
      "Update a Google Meet space's config: access type, moderation, recording/transcription auto-generation. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Space resource name, e.g. 'spaces/jQCFfuBOdN5z'"),
        config: z
          .object({
            accessType: z.enum(["OPEN", "TRUSTED", "RESTRICTED"]).optional(),
            moderation: z.enum(["OFF", "ON"]).optional(),
          })
          .passthrough()
          .optional()
          .describe("Fields to change on the space"),
        updateMask: z
          .string()
          .optional()
          .describe("Comma-separated field names to update, or '*' for all provided fields"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Meet space ${String(a["name"] ?? "")}`,
      preview: "Update meeting space configuration",
      confirmText: "Update meeting",
    }),
  },
]

export function makeComposioMeetDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-meet",
    name: "Google Meet",
    category: "meetings",
    icon: "google-meet",
    description:
      "Create meeting links and read past calls, recordings, and transcripts (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: MEET_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MEET_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_MEET_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-meet to route Meet through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_MEET_AUTH_CONFIG_ID",
          label: "Composio Meet auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googlemeet",
    },
    tools: createComposioTools({
      provider: "google-meet",
      toolkit: MEET_TOOLKIT,
      specs: meetComposioSpecs,
      executor,
    }),
  }
}
