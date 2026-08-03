import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectRows: { id: string; status?: string }[] = []
let fallbackSelectRows: { id: string; status?: string }[] = []
let selectCallCount = 0
let insertedSources: Record<string, unknown>[] = []
let nextSourceId = 1
let insertConflicts = false
let updateCalls: Record<string, unknown>[] = []

mock.module("@yomi/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selectCallCount++
            return Promise.resolve(selectCallCount === 1 ? selectRows : fallbackSelectRows)
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertConflicts) return Promise.resolve([])
            const id = `source-${nextSourceId++}`
            insertedSources.push({ id, ...v })
            return Promise.resolve([{ id, ...v }])
          },
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push(v)
          return Promise.resolve()
        },
      }),
    }),
  },
  ragSources: { __name: "rag_sources" },
}))

const { ensureSource } = await import("./source-lookup.js")

const manualOpts = { path: "chat-notes", name: "Chat notes", sourceType: "manual" }

beforeEach(() => {
  selectRows = []
  fallbackSelectRows = []
  selectCallCount = 0
  insertedSources = []
  nextSourceId = 1
  insertConflicts = false
  updateCalls = []
})

describe("ensureSource", () => {
  it("creates a source on first call", async () => {
    const id = await ensureSource("u1", manualOpts)
    expect(id).toBe("source-1")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["sourceType"]).toBe("manual")
    expect(insertedSources[0]!["userId"]).toBe("u1")
  })

  it("reuses the existing source on a later call", async () => {
    selectRows = [{ id: "existing-source" }]
    const id = await ensureSource("u1", manualOpts)
    expect(id).toBe("existing-source")
    expect(insertedSources).toHaveLength(0)
  })

  it("does not reuse a soft-deleted source", async () => {
    selectRows = []
    const id = await ensureSource("u1", manualOpts)
    expect(id).toBe("source-1")
    expect(id).not.toBe("existing-deleted-source")
    expect(insertedSources).toHaveLength(1)
    expect(insertedSources[0]!["path"]).toBe("chat-notes")
  })

  it("resurrects a soft-deleted source when the insert conflicts on a deleted row's slot", async () => {
    selectRows = []
    fallbackSelectRows = [{ id: "deleted-source", status: "deleted" }]
    insertConflicts = true

    const id = await ensureSource("u1", manualOpts)

    expect(id).toBe("deleted-source")
    expect(insertedSources).toHaveLength(0)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!["status"]).toBe("ready")
    expect(updateCalls[0]!["updatedAt"]).toBeInstanceOf(Date)
  })

  it("works with a different path/name/sourceType for a different bucket", async () => {
    const urlOpts = { path: "indexed-urls", name: "Indexed URLs", sourceType: "url" }
    await ensureSource("u1", urlOpts)
    expect(insertedSources[0]!["path"]).toBe("indexed-urls")
    expect(insertedSources[0]!["name"]).toBe("Indexed URLs")
    expect(insertedSources[0]!["sourceType"]).toBe("url")
  })
})
