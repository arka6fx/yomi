import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

interface ConferenceRecord {
  name?: string // conferenceRecords/{id}
  startTime?: string
  endTime?: string
  space?: string
}

// A 403 means two completely different things depending on what we were doing, and
// this used to report the mutation reason for BOTH — so "create a link with restricted
// access" (rejected because RESTRICTED is a Workspace feature) came back claiming Yomi
// can only manage spaces it created, which had nothing to do with it.
function meetWriteError(err: unknown, op: "create" | "mutate" = "mutate"): {
  error: string
  hint?: string
} {
  const msg = err instanceof Error ? err.message : String(err)
  if (/403|PERMISSION_DENIED/i.test(msg)) {
    if (op === "create") {
      return {
        error:
          "Google rejected the meeting settings. RESTRICTED access is a Google Workspace feature and is normally unavailable on a personal Google account.",
        hint: "Use TRUSTED (invited people join directly, everyone else has to knock) or OPEN (anyone with the link joins). TRUSTED is the default and is what meet.google.com itself creates.",
      }
    }
    // Meet restricts space mutation to the app that created the space — the same
    // developer-project rule as Classroom's turnIn.
    return {
      error:
        "Google Meet only lets an app manage the meeting spaces it created itself — Yomi cannot end or reconfigure a meeting that was started from the Meet or Calendar UI (Google API restriction; no scope unlocks this).",
      hint: "Reading the meeting afterwards still works: use meet-listConferenceRecords and meet-getTranscript. To create a meeting Yomi CAN manage, use meet-createSpace, or calendar-createEventWithMeet to put one on the calendar.",
    }
  }
  return connectorError(err)
}

export function createMeetTools(ctx: ConnectorContext): ToolSet {
  async function meetApi<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "google-meet")
    const res = await fetch(`https://meet.googleapis.com/v2${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Meet API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  // Turn whatever the user has to hand — a meeting code from the link, or a full
  // resource name — into the resource name that spaces.patch requires. spaces.get
  // accepts either, so it does the translation for us.
  async function resolveSpaceName(idOrCode: string): Promise<string> {
    const trimmed = idOrCode.trim().replace(/^spaces\//, "")
    const space = await meetApi<{ name?: string }>(`/spaces/${encodeURIComponent(trimmed)}`)
    return space.name ?? `spaces/${trimmed}`
  }

  return {
    "meet-updateSpaceSettings": tool({
      description:
        "Change who can join an EXISTING Meet space — 'make my meeting open to anyone', 'lock it down " +
        "so only invited people get in'. Use this when the user wants to change an existing link; do " +
        "NOT call meet-createSpace, which mints a different link and leaves the one they already " +
        "shared untouched. Pass the spaceId or meeting code from meet-createSpace or meet-getSpace. " +
        "Only works on spaces this app created (Google restriction).",
      parameters: z.object({
        spaceId: z
          .string()
          .describe(
            "Space id from meet-createSpace (e.g. spaces/abc123) or the meeting code (e.g. mex-ifym-mfn)",
          ),
        accessType: z
          .enum(["OPEN", "TRUSTED", "RESTRICTED"])
          .describe(
            "OPEN = anyone with the link joins directly; TRUSTED = signed-in users join, others knock; RESTRICTED = only invited people",
          ),
      }),
      execute: async (args) => {
        const { spaceId, accessType } = args
        return gateWrite(
          ctx,
          {
            connector: "google-meet",
            action: "meet-updateSpaceSettings",
            risk: "write",
            title: `Change who can join the Meet space`,
            preview: `Access for ${spaceId} becomes ${accessType}.`,
            confirmText: "Change access",
          },
          args,
          async () => {
            try {
              // spaces.patch needs the space RESOURCE NAME, not the meeting code from
              // the link (jju-tncg-xos). Passing the code 403s — which reads as "the app
              // can only manage spaces it created" even when it did create it. spaces.get
              // does accept the code, so resolve through it first.
              const id = await resolveSpaceName(spaceId)
              const space = await meetApi<{
                name?: string
                meetingUri?: string
                config?: { accessType?: string }
              }>(`/${id}?updateMask=config.accessType`, {
                method: "PATCH",
                body: JSON.stringify({ config: { accessType } }),
              })
              return {
                ok: true,
                spaceId: space.name,
                link: space.meetingUri,
                accessType: space.config?.accessType ?? accessType,
                message: `Access changed to ${space.config?.accessType ?? accessType}. The existing link still works.`,
              }
            } catch (err) {
              return meetWriteError(err)
            }
          },
        )
      },
    }),

    "meet-createSpace": tool({
      description:
        "Create a NEW Google Meet meeting link the user can share. Use this for an ad-hoc 'give me a " +
        "Meet link'. To change who can join a link that already exists, use meet-updateSpaceSettings " +
        "instead — creating a new space hands the user a different link and silently leaves the one " +
        "they already shared unchanged. If the meeting should also appear on the user's calendar with " +
        "a time and guests, use calendar-createEventWithMeet instead — that both books the slot and " +
        "creates the link.",
      parameters: z.object({
        accessType: z
          .enum(["OPEN", "TRUSTED", "RESTRICTED"])
          .default("TRUSTED")
          .describe(
            "OPEN = anyone with the link joins directly; TRUSTED = invited people and colleagues join directly, everyone else has to knock (default, and what meet.google.com itself creates); RESTRICTED = only invited people — a Google Workspace feature that is normally REJECTED on a personal Google account, so prefer TRUSTED unless the user is on Workspace",
          ),
      }),
      execute: async (args) => {
        const { accessType } = args
        return gateWrite(
          ctx,
          {
            connector: "google-meet",
            action: "meet-createSpace",
            risk: "write",
            title: "Create a Google Meet link",
            preview: `A new Meet space will be created (access: ${accessType}).`,
            confirmText: "Create meeting",
          },
          args,
          async () => {
            try {
              const space = await meetApi<{ name?: string; meetingUri?: string; meetingCode?: string }>(
                "/spaces",
                { method: "POST", body: JSON.stringify({ config: { accessType } }) },
              )
              return {
                ok: true,
                spaceId: space.name,
                link: space.meetingUri,
                code: space.meetingCode,
                message: `Meet link ready: ${space.meetingUri ?? "(no URI returned)"}`,
              }
            } catch (err) {
              return meetWriteError(err, "create")
            }
          },
        )
      },
    }),

    "meet-getSpace": tool({
      description:
        "Get details of a Google Meet space — its link, meeting code, and access settings. " +
        "Accepts a space ID (spaces/abc123) or a meeting code from a Meet URL.",
      parameters: z.object({
        space: z.string().describe("Space ID like spaces/abc123, or the meeting code from the Meet URL"),
      }),
      execute: async ({ space }) => {
        try {
          const id = space.startsWith("spaces/") ? space : `spaces/${space}`
          const data = await meetApi<{
            name?: string
            meetingUri?: string
            meetingCode?: string
            config?: { accessType?: string; entryPointAccess?: string }
            activeConference?: { conferenceRecord?: string }
          }>(`/${id}`)
          return {
            spaceId: data.name,
            link: data.meetingUri,
            code: data.meetingCode,
            accessType: data.config?.accessType,
            inProgress: !!data.activeConference,
            activeConferenceRecord: data.activeConference?.conferenceRecord,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "meet-endActiveConference": tool({
      description:
        "End the call currently happening in a Meet space, kicking everyone out. Only works on spaces " +
        "Yomi created itself (meet-createSpace) — Google blocks it for meetings started elsewhere.",
      parameters: z.object({
        space: z.string().describe("Space ID like spaces/abc123"),
      }),
      execute: async (args) => {
        const { space } = args
        return gateWrite(
          ctx,
          {
            connector: "google-meet",
            action: "meet-endActiveConference",
            risk: "irreversible",
            title: "End an active Meet call",
            preview: `Everyone currently in ${space} will be disconnected.`,
            confirmText: "End meeting",
          },
          args,
          async () => {
            try {
              const id = space.startsWith("spaces/") ? space : `spaces/${space}`
              await meetApi(`/${id}:endActiveConference`, { method: "POST", body: "{}" })
              return { ok: true, message: "Meeting ended." }
            } catch (err) {
              return meetWriteError(err)
            }
          },
        )
      },
    }),

    "meet-listConferenceRecords": tool({
      description:
        "List the user's past Google Meet calls, most recent first. Each record has an id you can " +
        "pass to meet-getConferenceRecord (who attended) or meet-getTranscript (what was said). " +
        "Start here for 'summarize my last meeting' or 'who was on that call'.",
      parameters: z.object({
        maxResults: z.number().int().min(1).max(50).default(10).describe("Max meetings to return"),
      }),
      execute: async ({ maxResults }) => {
        try {
          const data = await meetApi<{ conferenceRecords?: ConferenceRecord[] }>(
            `/conferenceRecords?pageSize=${maxResults}`,
          )
          const records = (data.conferenceRecords ?? []).map((r) => ({
            id: r.name,
            space: r.space,
            startTime: r.startTime,
            endTime: r.endTime,
            stillRunning: !r.endTime,
          }))
          if (records.length === 0) {
            return {
              meetings: [],
              message:
                "No past Meet calls found. Google only keeps conference records for meetings held on this account, and they can take a few minutes to appear after a call ends.",
            }
          }
          return { count: records.length, meetings: records }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "meet-getConferenceRecord": tool({
      description:
        "Get details of one past Meet call, including everyone who attended and how long each person " +
        "stayed. Get the conferenceRecordId from meet-listConferenceRecords.",
      parameters: z.object({
        conferenceRecordId: z
          .string()
          .describe("Conference record id from meet-listConferenceRecords, e.g. conferenceRecords/abc"),
      }),
      execute: async ({ conferenceRecordId }) => {
        try {
          const id = conferenceRecordId.startsWith("conferenceRecords/")
            ? conferenceRecordId
            : `conferenceRecords/${conferenceRecordId}`
          const record = await meetApi<ConferenceRecord>(`/${id}`)
          const parts = await meetApi<{
            participants?: {
              name?: string
              earliestStartTime?: string
              latestEndTime?: string
              signedinUser?: { user?: string; displayName?: string }
              anonymousUser?: { displayName?: string }
              phoneUser?: { displayName?: string }
            }[]
          }>(`/${id}/participants?pageSize=100`)
          const participants = (parts.participants ?? []).map((p) => ({
            name:
              p.signedinUser?.displayName ??
              p.anonymousUser?.displayName ??
              p.phoneUser?.displayName ??
              "(unknown)",
            joined: p.earliestStartTime,
            left: p.latestEndTime,
          }))
          return {
            id: record.name,
            startTime: record.startTime,
            endTime: record.endTime,
            participantCount: participants.length,
            participants,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "meet-getTranscript": tool({
      description:
        "Get the transcript of a past Google Meet call — what each person said, in order. Use this to " +
        "summarize a meeting or pull out action items. Get the conferenceRecordId from " +
        "meet-listConferenceRecords. IMPORTANT: a transcript only exists if transcription was turned " +
        "on during the call, which is a paid Google Workspace feature — on a personal @gmail.com " +
        "account there will be none, and that is not an error.",
      parameters: z.object({
        conferenceRecordId: z
          .string()
          .describe("Conference record id from meet-listConferenceRecords"),
        maxEntries: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(200)
          .describe("Max speech entries to return"),
      }),
      execute: async ({ conferenceRecordId, maxEntries }) => {
        try {
          const id = conferenceRecordId.startsWith("conferenceRecords/")
            ? conferenceRecordId
            : `conferenceRecords/${conferenceRecordId}`
          const list = await meetApi<{ transcripts?: { name?: string; state?: string }[] }>(
            `/${id}/transcripts`,
          )
          const transcript = list.transcripts?.[0]
          if (!transcript?.name) {
            return {
              entries: [],
              message:
                "This meeting has no transcript. Transcription must be switched on during the call, and it requires a paid Google Workspace plan — personal Gmail accounts cannot produce one.",
            }
          }
          const data = await meetApi<{
            transcriptEntries?: {
              participant?: string
              text?: string
              startTime?: string
              endTime?: string
            }[]
          }>(`/${transcript.name}/entries?pageSize=${maxEntries}`)
          const entries = (data.transcriptEntries ?? []).map((e) => ({
            speaker: e.participant,
            text: e.text,
            at: e.startTime,
          }))
          if (entries.length === 0) {
            return { entries: [], message: "The transcript exists but is empty." }
          }
          return { transcriptId: transcript.name, count: entries.length, entries }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const googleMeetDef: ConnectorDef = {
  id: "google-meet",
  name: "Google Meet",
  category: "meetings",
  icon: "google-meet",
  description:
    "Create Google Meet links, and read past calls — who attended and what was said (transcripts require a paid Workspace plan).",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // Create and manage spaces Yomi itself created. Google blocks mutation of
      // spaces created by other apps (incl. the Meet UI) regardless of scope.
      "https://www.googleapis.com/auth/meetings.space.created",
      // Read conference records, participants, and transcripts for any of the
      // user's meetings — not subject to the same-app restriction above.
      "https://www.googleapis.com/auth/meetings.space.readonly",
      "https://www.googleapis.com/auth/meetings.space.settings",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google-meet",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Use the same Google Cloud project as Gmail (GOOGLE_INTEGRATIONS_CLIENT_ID)",
      "Enable Google Meet API under APIs & Services → Library",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-meet",
      "meetings.space.created and .readonly are sensitive scopes — brand verification, no CASA",
      "NOTE: meeting transcripts require a paid Google Workspace plan; personal Gmail accounts return none",
    ],
    collect: [
      {
        env: "GOOGLE_INTEGRATIONS_CLIENT_ID",
        label: "Google Client ID (same as Gmail)",
        secret: false,
      },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/meet/api/guides/overview",
  },
  tools: createMeetTools,
}
