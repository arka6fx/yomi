import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

function formatDue(
  dueDate?: { year: number; month: number; day: number },
  dueTime?: { hours?: number; minutes?: number },
): string | undefined {
  if (!dueDate) return undefined
  const mm = String(dueDate.month).padStart(2, "0")
  const dd = String(dueDate.day).padStart(2, "0")
  if (!dueTime || dueTime.hours === undefined) return `${dueDate.year}-${mm}-${dd}`
  const hh = String(dueTime.hours).padStart(2, "0")
  const min = String(dueTime.minutes ?? 0).padStart(2, "0")
  return `${dueDate.year}-${mm}-${dd} ${hh}:${min} UTC`
}

export function createClassroomTools(ctx: ConnectorContext): ToolSet {
  async function classroom<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "google-classroom")
    const base = "https://classroom.googleapis.com/v1"
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
      throw new Error(`Classroom API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  async function getMySubmissionId(courseId: string, courseWorkId: string): Promise<string> {
    const data = await classroom<{
      studentSubmissions?: { id: string }[]
    }>(
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions?userId=me`,
    )
    const sub = data.studentSubmissions?.[0]
    if (!sub) throw new Error("No submission record found for this assignment. Are you enrolled?")
    return sub.id
  }

  return {
    "classroom-listCourses": tool({
      description:
        "List the user's active Google Classroom classes. Returns course IDs and names — pass the courseId to classroom-listAssignments. Note: Classroom API access is limited on personal Google accounts (full access needs a Workspace for Education account).",
      parameters: z.object({}),
      execute: async () => {
        try {
          const data = await classroom<{
            courses?: {
              id: string
              name?: string
              section?: string
              descriptionHeading?: string
              alternateLink?: string
            }[]
          }>("/courses?courseStates=ACTIVE&pageSize=50")
          const courses = (data.courses ?? []).map((c) => ({
            id: c.id,
            name: c.name ?? "(untitled)",
            section: c.section,
            link: c.alternateLink,
          }))
          if (courses.length === 0) {
            return {
              courses: [],
              message:
                "No active classes found. If you expected some, note that the Classroom API is limited on personal Gmail accounts.",
            }
          }
          return { count: courses.length, courses }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "classroom-listAssignments": tool({
      description:
        "List assignments (coursework) for a Classroom course, with due dates and links. Get the courseId from classroom-listCourses first.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        limit: z.number().int().min(1).max(40).default(20).describe("Max assignments to return"),
      }),
      execute: async ({ courseId, limit }) => {
        try {
          const data = await classroom<{
            courseWork?: {
              id: string
              title?: string
              description?: string
              dueDate?: { year: number; month: number; day: number }
              dueTime?: { hours?: number; minutes?: number }
              maxPoints?: number
              workType?: string
              state?: string
              alternateLink?: string
            }[]
          }>(`/courses/${encodeURIComponent(courseId)}/courseWork?pageSize=${limit}`)
          const assignments = (data.courseWork ?? []).map((w) => ({
            id: w.id,
            title: w.title ?? "(untitled)",
            due: formatDue(w.dueDate, w.dueTime) ?? "No due date",
            points: w.maxPoints,
            type: w.workType,
            link: w.alternateLink,
            description: w.description?.slice(0, 400),
          }))
          if (assignments.length === 0)
            return { assignments: [], message: "No assignments found for this course." }
          return { count: assignments.length, assignments }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "classroom-listAnnouncements": tool({
      description:
        "List recent announcements posted in a Classroom course. Get the courseId from classroom-listCourses.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        limit: z.number().int().min(1).max(30).default(15).describe("Max announcements to return"),
      }),
      execute: async ({ courseId, limit }) => {
        try {
          const data = await classroom<{
            announcements?: {
              id: string
              text?: string
              creationTime?: string
              alternateLink?: string
            }[]
          }>(`/courses/${encodeURIComponent(courseId)}/announcements?pageSize=${limit}`)
          const announcements = (data.announcements ?? []).map((a) => ({
            id: a.id,
            text: a.text?.slice(0, 800) ?? "",
            posted: a.creationTime,
            link: a.alternateLink,
          }))
          if (announcements.length === 0)
            return { announcements: [], message: "No announcements found for this course." }
          return { count: announcements.length, announcements }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "classroom-getSubmissionStatus": tool({
      description:
        "Check the user's own submission state and grade for a specific assignment. Also returns the submission ID needed for classroom-modifyAttachments and classroom-turnIn. Get courseId and courseWorkId from classroom-listAssignments first.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        courseWorkId: z.string().describe("Assignment (courseWork) ID"),
      }),
      execute: async ({ courseId, courseWorkId }) => {
        try {
          const data = await classroom<{
            studentSubmissions?: {
              id: string
              state?: string
              late?: boolean
              assignedGrade?: number
              alternateLink?: string
              attachmentDetails?: { driveFile?: { id?: string; title?: string } }[]
            }[]
          }>(
            `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions?userId=me`,
          )
          const sub = data.studentSubmissions?.[0]
          if (!sub) return { message: "No submission record found for this assignment." }
          return {
            id: sub.id,
            state: sub.state,
            late: sub.late ?? false,
            grade: sub.assignedGrade ?? null,
            link: sub.alternateLink,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "classroom-modifyAttachments": tool({
      description:
        "Attach a Google Drive file to an assignment submission. Use this AFTER creating the file with drive-createFile. Requires courseId and courseWorkId from classroom-listAssignments, and a Drive fileId from drive-createFile.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        courseWorkId: z.string().describe("Assignment (courseWork) ID"),
        fileId: z.string().describe("Google Drive file ID to attach (from drive-createFile)"),
        fileName: z
          .string()
          .optional()
          .describe("Display name for the attachment (defaults to the Drive file's name)"),
      }),
      execute: async (args) => {
        const { courseId, courseWorkId, fileId, fileName } = args
        return gateWrite(
          ctx,
          {
            connector: "google-classroom",
            action: "classroom-modifyAttachments",
            risk: "write",
            title: `Attach file to Classroom assignment`,
            preview: `Attach Drive file ${fileId}${fileName ? ` as "${fileName}"` : ""} to assignment ${courseWorkId} in course ${courseId}`,
            confirmText: "Attach file",
          },
          args,
          async () => {
            try {
              const submissionId = await getMySubmissionId(courseId, courseWorkId)
              const data = await classroom<{
                id?: string
                state?: string
              }>(
                `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:modifyAttachments`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    addAttachments: [
                      {
                        driveFile: {
                          id: fileId,
                          title: fileName ?? undefined,
                        },
                      },
                    ],
                  }),
                },
              )
              return {
                ok: true,
                submissionState: data.state,
                message: "File attached to submission.",
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "classroom-turnIn": tool({
      description:
        "Turn in (submit) an assignment. Call this AFTER attaching files with classroom-modifyAttachments. Requires courseId and courseWorkId from classroom-listAssignments. Turning in transfers ownership of attached Drive files to the teacher and prevents further edits.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        courseWorkId: z.string().describe("Assignment (courseWork) ID"),
      }),
      execute: async (args) => {
        const { courseId, courseWorkId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-classroom",
            action: "classroom-turnIn",
            risk: "write",
            title: `Turn in Classroom assignment`,
            preview: `Turn in assignment ${courseWorkId} in course ${courseId}`,
            confirmText: "Turn in",
          },
          args,
          async () => {
            try {
              const submissionId = await getMySubmissionId(courseId, courseWorkId)
              await classroom(
                `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:turnIn`,
                { method: "POST" },
              )
              return { ok: true, message: "Assignment turned in successfully." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),
  }
}

export const googleClassroomDef: ConnectorDef = {
  id: "google-classroom",
  name: "Google Classroom",
  category: "productivity",
  icon: "google-classroom",
  description:
    "Read your Google Classroom classes, assignments, due dates, announcements, grades, and submit work.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me",
      "https://www.googleapis.com/auth/classroom.announcements.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google-classroom",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Use the same Google Cloud project as Gmail (GOOGLE_INTEGRATIONS_CLIENT_ID)",
      "Enable Google Classroom API under APIs & Services → Library",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-classroom",
      "Classroom scopes are restricted: add your email under OAuth consent screen → Test users for personal use, or complete CASA verification to release to all users",
      "NOTE: Classroom API is limited on personal Gmail accounts — full access needs a Google Workspace for Education account",
    ],
    collect: [
      {
        env: "GOOGLE_INTEGRATIONS_CLIENT_ID",
        label: "Google Client ID (same as Gmail)",
        secret: false,
      },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/classroom/reference/rest",
  },
  tools: createClassroomTools,
}
