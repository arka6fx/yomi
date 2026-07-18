import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CLASSROOM_TOOLKIT = "googleclassroom"

export const classroomComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLECLASSROOM_LIST_COURSES",
    description:
      "List the user's active Google Classroom courses. Returns course IDs and names. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GOOGLECLASSROOM_LIST_ASSIGNMENTS",
    description:
      "List coursework (assignments) for a course with due dates and links. Get the courseId from GOOGLECLASSROOM_LIST_COURSES first. Read-only.",
    parameters: z
      .object({
        course_id: z.string().describe("Classroom course ID"),
        page_size: z.number().int().min(1).max(50).optional().describe("Max assignments to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECLASSROOM_GET_ASSIGNMENT",
    description:
      "Read one Classroom assignment in full: the question, attached materials, due date, and points. Read-only.",
    parameters: z
      .object({
        course_id: z.string().describe("Classroom course ID"),
        course_work_id: z.string().describe("Assignment (courseWork) ID"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECLASSROOM_LIST_ANNOUNCEMENTS",
    description:
      "List recent announcements posted in a Classroom course. Read-only.",
    parameters: z
      .object({
        course_id: z.string().describe("Classroom course ID"),
        page_size: z.number().int().min(1).max(30).optional().describe("Max announcements to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECLASSROOM_GET_SUBMISSION",
    description:
      "Check the user's submission state and grade for a specific assignment. Read-only.",
    parameters: z
      .object({
        course_id: z.string().describe("Classroom course ID"),
        course_work_id: z.string().describe("Assignment (courseWork) ID"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLECLASSROOM_TURN_IN",
    description:
      "Turn in (submit) an assignment. ONLY works on coursework created through the same developer project — teacher-created assignments return an error (Google API restriction). Requires user approval before it runs.",
    parameters: z
      .object({
        course_id: z.string().describe("Classroom course ID"),
        course_work_id: z.string().describe("Assignment (courseWork) ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Turn in Classroom assignment",
      preview: `Turn in assignment ${String(a["course_work_id"] ?? "").slice(0, 12)} in course ${String(a["course_id"] ?? "").slice(0, 12)}`,
      confirmText: "Turn in",
    }),
  },
  {
    slug: "GOOGLECLASSROOM_ATTACH_FILE",
    description:
      "Attach a Google Drive file to an assignment submission. ONLY works on coursework created through the same developer project. Requires user approval before it runs.",
    parameters: z
      .object({
        course_id: z.string().describe("Classroom course ID"),
        course_work_id: z.string().describe("Assignment (courseWork) ID"),
        file_id: z.string().describe("Google Drive file ID to attach"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Attach file to Classroom assignment",
      preview: `Attach file ${String(a["file_id"] ?? "").slice(0, 12)} to assignment ${String(a["course_work_id"] ?? "").slice(0, 12)}`,
      confirmText: "Attach file",
    }),
  },
]

export function makeComposioClassroomDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-classroom",
    name: "Google Classroom",
    category: "productivity",
    icon: "google-classroom",
    description: "List courses, assignments, and announcements from Google Classroom (via Composio).",
    readOnlyByDefault: false,
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
