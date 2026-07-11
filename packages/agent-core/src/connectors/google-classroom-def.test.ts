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

describe("classroom-listAssignments", () => {
  // Classroom returns coursework in creation order, so "what's my next assignment"
  // once answered with an undated lab sheet from one class while a paper due in two
  // days sat in another. Deadline order across every class is the whole point.
  function multiCourseFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/courses?courseStates=ACTIVE")) {
        return Response.json({
          courses: [
            { id: "c_dbms", name: "DBMSLABSecA" },
            { id: "c_phys", name: "Physics 101" },
          ],
        })
      }
      if (url.includes("/courses/c_dbms/courseWork")) {
        return Response.json({
          courseWork: [{ id: "w_lab", title: "Lab exam top sheet" }], // no due date
        })
      }
      if (url.includes("/courses/c_phys/courseWork")) {
        return Response.json({
          courseWork: [
            { id: "w_late", title: "Final essay", dueDate: { year: 2026, month: 9, day: 1 } },
            { id: "w_soon", title: "Newton's Laws", dueDate: { year: 2026, month: 7, day: 15 } },
          ],
        })
      }
      return Response.json({})
    }) as typeof fetch
  }

  it("sorts by deadline across every class and puts undated work last", async () => {
    multiCourseFetch()
    const result = (await executeTool("classroom-listAssignments", { limit: 20 })) as {
      assignments: { id: string; courseName?: string }[]
    }

    expect(result.assignments.map((a) => a.id)).toEqual(["w_soon", "w_late", "w_lab"])
    // Each row must carry its class, or the agent cannot say which class it belongs to.
    expect(result.assignments[0]).toMatchObject({ courseName: "Physics 101" })
    expect(result.assignments[2]).toMatchObject({ courseName: "DBMSLABSecA" })
  })

  it("flags a truncated description instead of passing it off as the assignment", async () => {
    // Real failure: a 430-char description put "Name the file X_Y_PS2" last, the
    // 400-char slice ate it, and Yomi reported the format with a blank file name.
    const tail = "Name the file Name_RollNumber_PS2."
    const long = `${"Answer all three questions. ".repeat(15)}${tail}`
    expect(long.length).toBeGreaterThan(400)

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/courses?courseStates=ACTIVE"))
        return Response.json({ courses: [{ id: "c_phys", name: "Physics 101" }] })
      if (url.includes("/courseWork"))
        return Response.json({
          courseWork: [
            {
              id: "w_1",
              title: "Problem Set 2",
              description: long,
              dueDate: { year: 2026, month: 7, day: 16 },
            },
          ],
        })
      return Response.json({})
    }) as typeof fetch

    const result = (await executeTool("classroom-listAssignments", { limit: 20 })) as {
      assignments: { descriptionPreview?: string; descriptionTruncated?: boolean }[]
    }
    const row = result.assignments[0]

    expect(row?.descriptionTruncated).toBe(true)
    // The preview must not pretend to be the whole thing.
    expect(row?.descriptionPreview).not.toContain(tail)
  })

  it("narrows to one class when a courseId is given", async () => {
    multiCourseFetch()
    const result = (await executeTool("classroom-listAssignments", {
      courseId: "c_dbms",
      limit: 20,
    })) as { assignments: { id: string }[] }

    expect(result.assignments.map((a) => a.id)).toEqual(["w_lab"])
  })
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
