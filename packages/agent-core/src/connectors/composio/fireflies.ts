import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const FIREFLIES_TOOLKIT = "fireflies"

export const firefliesComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "FIREFLIES_GET_TRANSCRIPTS",
    description:
      "List recorded meeting transcripts, optionally filtered by date/host/participant. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        skip: z.number().int().optional().describe("Results to skip"),
        title: z.string().optional().describe("Filter by meeting title"),
        from_date: z.string().optional().describe("Start date (ISO 8601)"),
        to_date: z.string().optional().describe("End date (ISO 8601)"),
        host_email: z.string().optional().describe("Filter by host email"),
        participant_email: z.string().optional().describe("Filter by participant email"),
      })
      .passthrough(),
  },
  {
    slug: "FIREFLIES_GET_TRANSCRIPT_BY_ID",
    description: "Get the full transcript and metadata for a meeting. Read-only.",
    parameters: z.object({ id: z.string().describe("Fireflies transcript ID") }).passthrough(),
  },
  {
    slug: "FIREFLIES_GET_USERS",
    description: "List users/team members. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "FIREFLIES_GET_USER_BY_ID",
    description: "Get details of a specific user. Read-only.",
    parameters: z.object({ id: z.string().describe("Fireflies user ID") }).passthrough(),
  },
  {
    slug: "FIREFLIES_GET_BITES",
    description:
      "List Bites (highlight clips) — optionally scoped to yourself, your team, or a transcript. Read-only.",
    parameters: z
      .object({
        mine: z.boolean().optional().describe("Only bites created by you"),
        my_team: z.boolean().optional().describe("Only bites from your team"),
        transcript_id: z.string().optional().describe("Filter by source transcript"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "FIREFLIES_GET_BITE_BY_ID",
    description: "Get details of a specific Bite. Read-only.",
    parameters: z.object({ id: z.string().describe("Bite ID") }).passthrough(),
  },
  {
    slug: "FIREFLIES_FETCH_AI_APP_OUTPUTS",
    description:
      "Fetch AI-app outputs (e.g. summaries, action items) for a meeting/transcript. Read-only.",
    parameters: z
      .object({
        app_id: z.string().describe("Fireflies AI app ID"),
        transcript_id: z.string().describe("Transcript ID"),
      })
      .passthrough(),
  },
  {
    slug: "FIREFLIES_ADD_TO_LIVE",
    description:
      "Add the Fireflies bot to an ongoing meeting to start recording. Requires approval.",
    parameters: z
      .object({
        meeting_link: z.string().describe("Meeting URL to join"),
        title: z.string().optional().describe("Meeting title"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add Fireflies bot to meeting",
      preview: `Join ${String(a["meeting_link"] ?? "")}`,
      confirmText: "Add bot",
    }),
  },
  {
    slug: "FIREFLIES_UPLOAD_AUDIO",
    description: "Upload an audio file for transcription. Requires approval.",
    parameters: z
      .object({
        url: z.string().describe("URL of the audio file to transcribe"),
        title: z.string().describe("Title for the transcript"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Upload audio for transcription",
      preview: `Transcribe "${String(a["title"] ?? "")}"`,
      confirmText: "Upload",
    }),
  },
  {
    slug: "FIREFLIES_DELETE_TRANSCRIPT_BY_ID",
    description: "Delete a specific transcript. Irreversible.",
    parameters: z.object({ id: z.string().describe("Fireflies transcript ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete transcript",
      preview: `Delete transcript ${String(a["id"] ?? "")}`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioFirefliesDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "fireflies",
    name: "Fireflies",
    category: "meetings",
    icon: "fireflies",
    description:
      "Fireflies — AI meeting assistant that records, transcribes, and summarizes meetings across Zoom, Google Meet, Teams, and more (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: FIREFLIES_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_FIREFLIES_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.fireflies.ai",
      steps: [
        "Create a Fireflies auth config in Composio (API key)",
        "Set COMPOSIO_API_KEY and COMPOSIO_FIREFLIES_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=fireflies to route Fireflies through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_FIREFLIES_AUTH_CONFIG_ID",
          label: "Composio Fireflies auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/fireflies",
    },
    tools: createComposioTools({
      provider: "fireflies",
      toolkit: FIREFLIES_TOOLKIT,
      specs: firefliesComposioSpecs,
      executor,
    }),
  }
}
