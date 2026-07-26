import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CLASSROOM_TOOLKIT = "google_classroom"

// Composio's Google Classroom toolkit is NOT read-only — confirmed live
// (GET /api/v3/tools?toolkit_slug=google_classroom), it has 20+ write actions
// (COURSE_WORK_CREATE, COURSES_ANNOUNCEMENTS_CREATE, COURSES_TOPICS_CREATE, etc.).
// Yomi only implements reads today, by choice, not because the toolkit lacks
// writes — a real gap if per-course posting/coursework-creation gets requested.
// One real constraint if that gets built: the granted OAuth scopes (confirmed
// live via GET /api/v3/toolkits/google_classroom) include classroom.courses.
// readonly but NOT the full classroom.courses scope, so COURSES_CREATE/
// COURSES_DELETE/COURSES_PATCH (course-level writes) would fail auth even if
// implemented — coursework/announcements/topics/materials writes ARE grantable
// (classroom.coursework.students, classroom.announcements, classroom.topics,
// classroom.courseworkmaterials are all present as full, non-readonly scopes).
// All params use Classroom API's native camelCase field names (courseId,
// courseWorkId, …), not snake_case.
export const classroomComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLE_CLASSROOM_COURSES_LIST",
    description:
      "List the user's active Google Classroom courses. Returns course IDs and names. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().min(1).max(50).optional().describe("Max courses to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLASSROOM_COURSE_WORK_LIST",
    description:
      "List coursework (assignments) for a course with due dates and links. Get the courseId from GOOGLE_CLASSROOM_COURSES_LIST first. Read-only.",
    parameters: z
      .object({
        courseId: z.string().describe("Classroom course ID"),
        pageSize: z.number().int().min(1).max(50).optional().describe("Max assignments to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLASSROOM_COURSE_WORK_GET",
    description:
      "Read one Classroom assignment in full: the question, attached materials, due date, and points. Read-only.",
    parameters: z
      .object({
        courseId: z.string().describe("Classroom course ID"),
        id: z.string().describe("Assignment (courseWork) ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLASSROOM_COURSES_ANNOUNCEMENTS_LIST",
    description: "List recent announcements posted in a Classroom course. Read-only.",
    parameters: z
      .object({
        courseId: z.string().describe("Classroom course ID"),
        pageSize: z.number().int().min(1).max(30).optional().describe("Max announcements to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLASSROOM_COURSE_WORK_STUDENT_SUBMISSIONS_LIST",
    description:
      "Check the user's submission state and grade for a specific assignment (pass userId: 'me' to filter to the current user). Read-only.",
    parameters: z
      .object({
        courseId: z.string().describe("Classroom course ID"),
        courseWorkId: z.string().describe("Assignment (courseWork) ID, or '-' for all coursework"),
        userId: z.string().optional().describe("Restrict to a specific user, e.g. 'me'"),
      })
      .passthrough(),
  },
]

export function makeComposioClassroomDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-classroom",
    name: "Google Classroom",
    category: "productivity",
    icon: "google-classroom",
    description: "List courses, assignments, and announcements from Google Classroom (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: CLASSROOM_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CLASSROOM_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_CLASSROOM_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-classroom to route Classroom through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_CLASSROOM_AUTH_CONFIG_ID", label: "Composio Classroom auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googleclassroom",
    },
    tools: createComposioTools({
      provider: "google-classroom",
      toolkit: CLASSROOM_TOOLKIT,
      specs: classroomComposioSpecs,
      executor,
    }),
  }
}
