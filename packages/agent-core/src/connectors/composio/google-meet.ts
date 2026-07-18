import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const MEET_TOOLKIT = "googlemeet"

export const meetComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLEMEET_GET_SPACE",
    description:
      "Get details of a Google Meet space — its link, meeting code, and access settings. Read-only.",
    parameters: z
      .object({
        space_id: z.string().describe("Space ID or meeting code"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_LIST_CONFERENCE_RECORDS",
    description:
      "List the user's past Google Meet calls, most recent first. Each record has an id you can pass to GOOGLEMEET_GET_CONFERENCE_RECORD. Read-only.",
    parameters: z
      .object({
        page_size: z.number().int().min(1).max(50).optional().describe("Max records to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_GET_CONFERENCE_RECORD",
    description:
      "Get details of one past Meet call, including everyone who attended and how long each person stayed. Read-only.",
    parameters: z
      .object({
        conference_record_id: z.string().describe("Conference record ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLEMEET_GET_TRANSCRIPT",
    description:
      "Get the transcript of a past Google Meet call — what each person said, in order. Only available if transcription was enabled during the call (paid Workspace feature). Read-only.",
    parameters: z
      .object({
        conference_record_id: z.string().describe("Conference record ID"),
        page_size: z.number().int().min(1).max(500).optional().describe("Max transcript entries"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLEMEET_CREATE_SPACE",
    description:
      "Create a new Google Meet meeting link. Optionally configure who can join (access type). Requires user approval before it runs.",
    parameters: z
      .object({
        access_type: z.enum(["OPEN", "TRUSTED", "RESTRICTED"]).optional().describe("OPEN = anyone with link joins directly; TRUSTED = invited people join, others knock; RESTRICTED = only invited people (Workspace only)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create a Google Meet link",
      preview: `A new Meet space will be created (access: ${String(a["access_type"] ?? "TRUSTED")}).`,
      confirmText: "Create meeting",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLEMEET_END_ACTIVE_CONFERENCE",
    description:
      "End the call currently happening in a Meet space, kicking everyone out. Only works on spaces created by Yomi itself (Google restriction). This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        space_id: z.string().describe("Space ID to end the conference in"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "End active Meet call",
      preview: `Everyone currently in ${String(a["space_id"] ?? "").slice(0, 16)} will be disconnected.`,
      confirmText: "End meeting",
    }),
  },
]

export function makeComposioMeetDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-meet",
    name: "Google Meet",
    category: "meetings",
    icon: "google-meet",
    description: "Create Google Meet links and read past calls (via Composio).",
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
        { env: "COMPOSIO_MEET_AUTH_CONFIG_ID", label: "Composio Meet auth config id", secret: false },
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
