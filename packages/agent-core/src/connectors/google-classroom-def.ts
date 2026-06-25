import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

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
  // Classroom due times are UTC.
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
    return res.json() as Promise<T>
  }

  return {
    "classroom-listCourses": tool({
      description:
        "List the user's active Google Classroom classes. Returns course IDs and names — pass the courseId to classroom-listAssignments. Note: Classroom API access is limited on personal Google accounts (full access needs a Workspace for Education account).",
      parameters: z.object({}),
      execute: async () => {
        try {
          const data = await classroom<{
            courses?: { id: string; name?: string; section?: string; descriptionHeading?: string; alternateLink?: string }[]
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
          if (assignments.length === 0) return { assignments: [], message: "No assignments found for this course." }
          return { count: assignments.length, assignments }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "classroom-listAnnouncements": tool({
      description: "List recent announcements posted in a Classroom course. Get the courseId from classroom-listCourses.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        limit: z.number().int().min(1).max(30).default(15).describe("Max announcements to return"),
      }),
      execute: async ({ courseId, limit }) => {
        try {
          const data = await classroom<{
            announcements?: { id: string; text?: string; creationTime?: string; alternateLink?: string }[]
          }>(`/courses/${encodeURIComponent(courseId)}/announcements?pageSize=${limit}`)
          const announcements = (data.announcements ?? []).map((a) => ({
            id: a.id,
            text: a.text?.slice(0, 800) ?? "",
            posted: a.creationTime,
            link: a.alternateLink,
          }))
          if (announcements.length === 0) return { announcements: [], message: "No announcements found for this course." }
          return { count: announcements.length, announcements }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "classroom-getSubmissionStatus": tool({
      description:
        "Check the user's own submission state and grade for a specific assignment. Get courseId and courseWorkId from classroom-listAssignments. NOTE: Yomi can read status but cannot attach files or turn in assignments — Google's API blocks third-party apps from submitting on a student's behalf.",
      parameters: z.object({
        courseId: z.string().describe("Classroom course ID"),
        courseWorkId: z.string().describe("Assignment (courseWork) ID"),
      }),
      execute: async ({ courseId, courseWorkId }) => {
        try {
          const data = await classroom<{
            studentSubmissions?: { id: string; state?: string; late?: boolean; assignedGrade?: number; alternateLink?: string }[]
          }>(
            `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions?userId=me`,
          )
          const sub = data.studentSubmissions?.[0]
          if (!sub) return { message: "No submission record found for this assignment." }
          return {
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
  }
}

export const googleClassroomDef: ConnectorDef = {
  id: "google-classroom",
  name: "Google Classroom",
  category: "productivity",
  icon: "google-classroom",
  description: "Read your Google Classroom classes, assignments, due dates, announcements, and grades.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // Read-only student scopes. These are "restricted" — require Google CASA
      // verification for public release, or test-user allowlisting for personal use.
      // (Turning in assignments is intentionally not possible via the API for
      // third-party apps, so no write scopes are requested.)
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
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
      { env: "GOOGLE_INTEGRATIONS_CLIENT_ID", label: "Google Client ID (same as Gmail)", secret: false },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/classroom/reference/rest",
  },
  tools: createClassroomTools,
}
