import { describe, expect, it, mock } from "bun:test"

mock.module("../integration-tokens.js", () => ({
  getAccessToken: async () => "tok-123",
}))

const { makeDriveClient, DriveApiError } = await import("./drive-client.js")

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    const r = key ? routes[key] : { status: 404, body: {} }
    const text = JSON.stringify(r.body)
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as Response
  }
}

describe("driveClient", () => {
  it("lists folder children with the folder query and bearer token", async () => {
    let seenUrl = ""
    let seenAuth = ""
    const client = makeDriveClient((url: string, init?: any) => {
      seenUrl = url
      seenAuth = init?.headers?.Authorization ?? ""
      return fakeFetch({ "/files": { body: { files: [{ id: "f1", name: "n", mimeType: "text/plain" }] } } })(url)
    })
    const res = await client.listFolderChildren("u1", "folder-1")
    expect(res.files[0].id).toBe("f1")
    expect(seenUrl).toContain("folder-1")
    expect(seenAuth).toBe("Bearer tok-123")
  })

  it("throws DriveApiError with status on non-ok", async () => {
    const client = makeDriveClient(fakeFetch({ "/changes": { status: 410, body: { error: "gone" } } }) as any)
    await expect(client.listChanges("u1", "ptok")).rejects.toBeInstanceOf(DriveApiError)
  })
})
