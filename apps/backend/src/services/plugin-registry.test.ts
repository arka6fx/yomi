import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginDef } from "@yomi/shared"

// PluginRegistry integration test (issue #75): register a plugin, query its
// capability manifest, and verify it against a granted capability set. Mocks
// the DB (isolated per file under `bun test --isolate`) the same way
// agent-sessions.test.ts / pending-actions tests do, following prior art.

interface FakeRow {
  id: string
  pluginId: string
  name: string
  version: string
  entrypoint: string
  requiredCapabilities: string[]
  optionalCapabilities: string[]
  permissions: string[]
  registeredAt: Date
  updatedAt: Date
}

let rows: FakeRow[] = []
let nextId = 1

function matches(row: FakeRow, pluginId: string) {
  return row.pluginId === pluginId
}

const fakeDb = {
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      onConflictDoUpdate: (conflict: { target: unknown; set: Record<string, unknown> }) => ({
        returning: () => {
          const existing = rows.find((r) => matches(r, v["pluginId"] as string))
          if (existing) {
            Object.assign(existing, conflict.set)
            return Promise.resolve([existing])
          }
          const row: FakeRow = {
            id: `plugin_${nextId++}`,
            pluginId: v["pluginId"] as string,
            name: v["name"] as string,
            version: v["version"] as string,
            entrypoint: v["entrypoint"] as string,
            requiredCapabilities: v["requiredCapabilities"] as string[],
            optionalCapabilities: v["optionalCapabilities"] as string[],
            permissions: v["permissions"] as string[],
            registeredAt: new Date(),
            updatedAt: new Date(),
          }
          rows.push(row)
          return Promise.resolve([row])
        },
      }),
    }),
  }),
  select: () => ({
    from: () => ({
      where: (predicate: (row: FakeRow) => boolean) => Promise.resolve(rows.filter(predicate)),
      then: (resolve: (rows: FakeRow[]) => void) => resolve(rows),
    }),
  }),
  delete: () => ({
    where: (predicate: (row: FakeRow) => boolean) => {
      const before = rows.length
      rows = rows.filter((r) => !predicate(r))
      return Promise.resolve({ rowCount: before - rows.length })
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb, plugins: {} }))
mock.module("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => (row: FakeRow) => row.pluginId === value,
}))

const { registerPlugin, unregisterPlugin, getPlugin, listPlugins, checkPluginAccess } =
  await import("./plugin-registry.js")

const samplePlugin: PluginDef = {
  id: "browser-automation",
  name: "Browser Automation",
  version: "1.0.0",
  capabilities: {
    required: ["filesystem:read", "connector:execute"],
    optional: ["memory:write"],
    permissions: ["screen-capture"],
  },
  entrypoint: "plugins/browser-automation/index.js",
}

beforeEach(() => {
  rows = []
  nextId = 1
})

describe("registerPlugin", () => {
  it("stores the plugin's capability manifest", async () => {
    const registered = await registerPlugin(samplePlugin)
    expect(registered.pluginId).toBe("browser-automation")
    expect(registered.requiredCapabilities).toEqual(["filesystem:read", "connector:execute"])
  })

  it("re-registering the same id updates the row instead of duplicating it", async () => {
    await registerPlugin(samplePlugin)
    await registerPlugin({ ...samplePlugin, version: "1.1.0" })
    const all = await listPlugins()
    expect(all).toHaveLength(1)
    expect(all[0]?.version).toBe("1.1.0")
  })
})

describe("getPlugin / listPlugins", () => {
  it("returns null for an unregistered plugin id", async () => {
    expect(await getPlugin("nope")).toBeNull()
  })

  it("returns the registered plugin by id", async () => {
    await registerPlugin(samplePlugin)
    const found = await getPlugin("browser-automation")
    expect(found?.name).toBe("Browser Automation")
  })
})

describe("unregisterPlugin", () => {
  it("removes a registered plugin", async () => {
    await registerPlugin(samplePlugin)
    await unregisterPlugin("browser-automation")
    expect(await getPlugin("browser-automation")).toBeNull()
  })
})

describe("checkPluginAccess", () => {
  it("is satisfied when the granted set covers all required scopes", async () => {
    await registerPlugin(samplePlugin)
    const result = await checkPluginAccess("browser-automation", [
      "filesystem:*",
      "connector:execute",
    ])
    expect(result.satisfied).toBe(true)
    expect(result.missing).toEqual([])
  })

  it("lists missing required scopes when the grant falls short", async () => {
    await registerPlugin(samplePlugin)
    const result = await checkPluginAccess("browser-automation", ["filesystem:read"])
    expect(result.satisfied).toBe(false)
    expect(result.missing).toEqual(["connector:execute"])
  })

  it("throws for an unregistered plugin id", async () => {
    await expect(checkPluginAccess("nope", ["*:*"])).rejects.toThrow()
  })
})
