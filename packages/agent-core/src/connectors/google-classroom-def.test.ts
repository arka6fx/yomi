import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createClassroomTools } from "./google-classroom-def.js"

const originalFetch = globalThis.fetch
let turnInStatus = 200

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createClassroomTools({
    userId: "user_1",
    getAccessToken: async () => "classroom-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  turnInStatus = 200
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes(":turnIn")) {
      if (turnInStatus !== 200) {
        return new Response(
          JSON.stringify({
            error: { code: 403, status: "PERMISSION_DENIED", message: "@ProjectPermissionDenied" },
          }),
          { status: 403 },
        )
      }
      return new Response(null, { status: 204 })
    }
    if (url.includes("/studentSubmissions")) {
      return Response.json({ studentSubmissions: [{ id: "sub_1" }] })
    }
    if (url.includes("/courseWork/cw_1")) {
      return Response.json({
        id: "cw_1",
        title: "Essay on entropy",
        description: "Write 500 words about the second law.",
        alternateLink: "https://classroom.google.com/c/abc/a/cw_1",
        maxPoints: 100,
        materials: [
          {
            driveFile: {
              driveFile: {
                id: "drive_q1",
                title: "questions.pdf",
                alternateLink: "https://drive.google.com/file/d/drive_q1",
              },
            },
          },
          { link: { url: "https://example.com/rubric", title: "Rubric" } },
        ],
      })
    }
    return Response.json({})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("classroom-getAssignment", () => {
  it("returns the full description, materials, and deep link", async () => {
    const result = (await executeTool("classroom-getAssignment", {
      courseId: "course_1",
      courseWorkId: "cw_1",
    })) as {
      title?: string
      description?: string
      link?: string
      materials?: { type: string; driveFileId?: string; link?: string }[]
    }

    expect(result.title).toBe("Essay on entropy")
    expect(result.description).toContain("second law")
    expect(result.link).toBe("https://classroom.google.com/c/abc/a/cw_1")
    expect(result.materials).toHaveLength(2)
    expect(result.materials?.[0]).toMatchObject({ type: "driveFile", driveFileId: "drive_q1" })
    expect(result.materials?.[1]).toMatchObject({
      type: "link",
      link: "https://example.com/rubric",
    })
  })
})

describe("classroom-turnIn", () => {
  it("turns in when the API allows it", async () => {
    const result = (await executeTool("classroom-turnIn", {
      courseId: "course_1",
      courseWorkId: "cw_1",
    })) as { ok?: boolean }
    expect(result.ok).toBe(true)
  })

  it("translates the same-project 403 into the Drive deep-link workflow", async () => {
    turnInStatus = 403
    const result = (await executeTool("classroom-turnIn", {
      courseId: "course_1",
      courseWorkId: "cw_1",
    })) as { error?: string; hint?: string }
    expect(result.error).toContain("teacher-created assignments")
    expect(result.hint).toContain("drive-createFile")
    expect(result.hint).toContain("classroom-getAssignment")
  })
})
