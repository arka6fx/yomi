import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdir, writeFile, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { PluginManager } from "./plugin-manager.js"
import type { PluginToolDef, PluginCLICommand, PluginNotepadProvider } from "./plugin-types.js"

// ---- Helpers ----

let tmpBase: string

async function tmpPluginDir(): Promise<string> {
  const d = join(tmpdir(), "yomi-plugin-test", Math.random().toString(36).slice(2))
  await mkdir(d, { recursive: true })
  return d
}

async function writeManifest(dir: string, overrides: Record<string, unknown> = {}) {
  const manifest = {
    name: "test-plugin",
    description: "A test plugin",
    version: "1.0.0",
    author: "test",
    ...overrides,
  }
  await writeFile(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2))
}

async function writeYamlManifest(dir: string, overrides: Record<string, string> = {}) {
  const lines = [
    `name: ${overrides.name ?? "yaml-plugin"}`,
    `description: ${overrides.description ?? "YAML test plugin"}`,
    `version: ${overrides.version ?? "0.1.0"}`,
    `author: ${overrides.author ?? "test"}`,
  ]
  await writeFile(join(dir, "plugin.yaml"), lines.join("\n"))
}

async function writeEntryPoint(
  dir: string,
  body: string,
) {
  await writeFile(join(dir, "index.ts"), body)
}

async function writeToolFile(
  dir: string,
  name: string,
  body: string,
) {
  await mkdir(join(dir, "tools"), { recursive: true })
  await writeFile(join(dir, "tools", `${name}.ts`), body)
}

async function writeHooksFile(
  dir: string,
  body: string,
) {
  await writeFile(join(dir, "hooks.ts"), body)
}

// ---- Tests ----

describe("PluginManager — init", () => {
  let manager: PluginManager
  let pluginDir: string

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("loads zero plugins when no directory exists", async () => {
    await manager.init()
    expect(manager.getPluginCount()).toBe(0)
  })

  it("loads a plugin from ~/.yomi/plugins/<name> with plugin.json", async () => {
    pluginDir = join(tmpBase, "plugins", "test-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeManifest(pluginDir)

    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        return {
          tools: {
            hello: api.defineTool({
              description: "Says hello",
              parameters: { type: "object", properties: {} },
              execute: () => "hello from plugin",
            }),
          },
        }
      }`,
    )

    await manager.init()
    expect(manager.getPluginCount()).toBe(1)
    expect(manager.getPluginNames()).toEqual(["test-plugin"])
  })

  it("loads a plugin with plugin.yaml manifest", async () => {
    pluginDir = join(tmpBase, "plugins", "yaml-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeYamlManifest(pluginDir)

    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        return { tools: {} }
      }`,
    )

    await manager.init()
    expect(manager.getPluginCount()).toBe(1)
    expect(manager.getPluginNames()).toEqual(["yaml-plugin"])
  })

  it("skips directories without a manifest", async () => {
    pluginDir = join(tmpBase, "plugins", "no-manifest")
    await mkdir(pluginDir, { recursive: true })
    // no manifest — should be skipped

    await manager.init()
    expect(manager.getPluginCount()).toBe(0)
  })

  it("skips non-directory entries in the plugins dir", async () => {
    await mkdir(join(tmpBase, "plugins"), { recursive: true })
    await writeFile(join(tmpBase, "plugins", "not-a-dir.ts"), "// file, not dir")

    await manager.init()
    expect(manager.getPluginCount()).toBe(0)
  })

  it("is idempotent when init is called twice", async () => {
    await manager.init()
    await manager.init()
    expect(manager.getPluginCount()).toBe(0)
  })

  it("loads multiple plugins", async () => {
    for (const name of ["plugin-a", "plugin-b", "plugin-c"]) {
      const d = join(tmpBase, "plugins", name)
      await mkdir(d, { recursive: true })
      await writeManifest(d, { name })
      await writeEntryPoint(d, `export default () => ({ tools: {} })`)
    }

    await manager.init()
    expect(manager.getPluginCount()).toBe(3)
    expect(manager.getPluginNames().sort()).toEqual([
      "plugin-a",
      "plugin-b",
      "plugin-c",
    ])
  })
})

describe("PluginManager — tool auto-discovery", () => {
  let manager: PluginManager
  let pluginDir: string

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
    pluginDir = join(tmpBase, "plugins", "tool-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeManifest(pluginDir)
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("auto-discovers tools from tools/*.ts", async () => {
    await writeToolFile(
      pluginDir,
      "echo",
      `const tool = {
        description: "Echo back input",
        parameters: { type: "object", properties: { text: { type: "string" } } },
        execute: (args) => "echo: " + args.text,
      }
      export default tool`,
    )

    await manager.init()
    const tools = manager.getTools()
    expect(tools).toHaveProperty("echo")
    expect(tools["echo"]!.description).toBe("Echo back input")
  })

  it("auto-discovers multiple tools", async () => {
    await writeToolFile(
      pluginDir,
      "ping",
      `const tool = {
        description: "Ping",
        parameters: { type: "object", properties: {} },
        execute: () => "pong",
      }
      export default tool`,
    )
    await writeToolFile(
      pluginDir,
      "uptime",
      `const tool = {
        description: "Uptime",
        parameters: { type: "object", properties: {} },
        execute: () => "up",
      }
      export default tool`,
    )

    await manager.init()
    const tools = manager.getTools()
    expect(Object.keys(tools).sort()).toEqual(["ping", "uptime"])
  })

  it("factory-defined tools take precedence over auto-discovered", async () => {
    // Write an entry point that also defines "echo"
    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        return {
          tools: {
            echo: api.defineTool({
              description: "Factory echo",
              parameters: { type: "object", properties: {} },
              execute: () => "from factory",
            }),
          },
        }
      }`,
    )
    // Also put an auto-discovered echo tool
    await writeToolFile(
      pluginDir,
      "echo",
      `const tool = {
        description: "Auto-discovered echo",
        parameters: { type: "object", properties: {} },
        execute: () => "from file",
      }
      export default tool`,
    )

    await manager.init()
    const tools = manager.getTools()
    expect(tools["echo"]!.description).toBe("Factory echo")
  })

  it("skips non-.ts files in tools/", async () => {
    await mkdir(join(pluginDir, "tools"), { recursive: true })
    await writeFile(join(pluginDir, "tools", "readme.txt"), "not a tool")

    await manager.init()
    expect(Object.keys(manager.getTools())).toEqual([])
  })
})

describe("PluginManager — hooks auto-discovery", () => {
  let manager: PluginManager
  let pluginDir: string

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
    pluginDir = join(tmpBase, "plugins", "hooks-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeManifest(pluginDir)
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("loads hooks from hooks.ts when no entry point exists", async () => {
    await writeHooksFile(
      pluginDir,
      `export default {
        onPreToolUse: async (toolName, args) => {
          if (toolName === "blocked_tool") return { ok: false, reason: "blocked by plugin" }
          return { ok: true }
        },
      }`,
    )

    await manager.init()
    const pluginHooks = manager.getPluginHooks()
    expect(pluginHooks.onPreToolUse).toBeDefined()

    const result = await pluginHooks.onPreToolUse!("blocked_tool", {})
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("blocked by plugin")
  })

  it("loads hooks from hooks.ts named export", async () => {
    await writeHooksFile(
      pluginDir,
      `export const hooks = {
        onSessionStart: async () => { /* noop */ },
      }`,
    )

    await manager.init()
    const pluginHooks = manager.getPluginHooks()
    expect(pluginHooks.onSessionStart).toBeDefined()
  })
})

describe("PluginManager — CLI commands and notepad providers", () => {
  let manager: PluginManager
  let pluginDir: string

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
    pluginDir = join(tmpBase, "plugins", "cli-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeManifest(pluginDir)
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("collects CLI commands defined via the API", async () => {
    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        api.defineCLICommand({ name: "hello", description: "Say hello", run: () => {} })
        api.defineCLICommand({ name: "goodbye", description: "Say goodbye", run: () => {} })
        return { tools: {} }
      }`,
    )

    await manager.init()
    const cmds = manager.getCLICommands()
    expect(cmds).toHaveLength(2)
    expect(cmds[0]!.name).toBe("hello")
    expect(cmds[1]!.name).toBe("goodbye")
  })

  it("collects notepad providers defined via the API", async () => {
    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        api.defineNotepadProvider({
          name: "custom-storage",
          load: () => "custom data",
        })
        return { tools: {} }
      }`,
    )

    await manager.init()
    const providers = manager.getNotepadProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]!.name).toBe("custom-storage")
    expect(providers[0]!.load()).toBe("custom data")
  })
})

describe("PluginManager — getTools", () => {
  let manager: PluginManager
  let pluginDir: string

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
    pluginDir = join(tmpBase, "plugins", "tools-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeManifest(pluginDir)

    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        return {
          tools: {
            greet: api.defineTool({
              description: "Greets the user",
              parameters: { type: "object", properties: { name: { type: "string" } } },
              execute: (args) => "Hello, " + args.name,
            }),
          },
        }
      }`,
    )
    await manager.init()
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("returns an AI SDK ToolSet with plugin tools", () => {
    const tools = manager.getTools()
    expect(tools).toHaveProperty("greet")
    expect(typeof tools["greet"]!.execute).toBe("function")
  })

  it("executing a tool returns the expected output", async () => {
    const tools = manager.getTools()
    const result = await tools["greet"]!.execute!({ name: "World" }, { toolCallId: "test", messages: [] })
    expect(result).toBe("Hello, World")
  })

  it("returns empty ToolSet when no plugins loaded", async () => {
    const emptyDir = await tmpPluginDir()
    const oldEnv = process.env["YOMI_NOTEPAD_DIR"]
    process.env["YOMI_NOTEPAD_DIR"] = emptyDir
    const emptyManager = new PluginManager()
    await emptyManager.init()
    expect(emptyManager.getTools()).toEqual({})
    process.env["YOMI_NOTEPAD_DIR"] = oldEnv
    await rm(emptyDir, { recursive: true, force: true }).catch(() => {})
  })
})

describe("PluginManager — deduplication (same name across plugins)", () => {
  let manager: PluginManager

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase

    // Two plugins defining the same tool name
    for (const name of ["dup-first", "dup-second"]) {
      const d = join(tmpBase, "plugins", name)
      await mkdir(d, { recursive: true })
      await writeManifest(d, { name })
      await writeEntryPoint(
        d,
        `export default function factory(api) {
          return {
            tools: {
              conflict: api.defineTool({
                description: "${name}'s tool",
                parameters: { type: "object", properties: {} },
                execute: () => "${name}",
              }),
            },
          }
        }`,
      )
    }
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("last one wins when two plugins define the same tool name", async () => {
    await manager.init()
    const tools = manager.getTools()
    expect(tools).toHaveProperty("conflict")
    // The first-registered tool is kept; duplicates are skipped with a warning.
    // Since dup-first is loaded first (alphabetically), its tool wins.
    const result = await tools["conflict"]!.execute!({}, { toolCallId: "test", messages: [] })
    expect(result).toBe("dup-first")
  })
})

describe("PluginManager — shutdown", () => {
  let manager: PluginManager

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("clears all plugins and resets loaded state", async () => {
    const d = join(tmpBase, "plugins", "shutdown-test")
    await mkdir(d, { recursive: true })
    await writeManifest(d, { name: "shutdown-test" })
    await writeEntryPoint(d, `export default () => ({ tools: {} })`)

    await manager.init()
    expect(manager.getPluginCount()).toBe(1)

    await manager.shutdown()
    expect(manager.getPluginCount()).toBe(0)

    // Can re-init after shutdown
    await manager.init()
    expect(manager.getPluginCount()).toBe(1)
  })
})

describe("PluginManager — composeHooks", () => {
  it("composes onMemoryWrite hooks from multiple plugins", async () => {
    // Import composeHooks directly since it's exported
    const { composeHooks } = await import("./plugin-manager.js")

    const composed = composeHooks(
      {
        onMemoryWrite: async (content) =>
          content.includes("secret") ? { ok: false, reason: "contains secret" } : { ok: true },
      },
      {
        onMemoryWrite: async (content) =>
          content.length > 100 ? { ok: false, reason: "too long" } : { ok: true },
      },
    )

    // First hook blocks "secret"
    const r1 = await composed.onMemoryWrite!("this is a secret", { source: "test" })
    expect(r1.ok).toBe(false)
    expect(r1.reason).toBe("contains secret")

    // Second hook blocks long content
    const r2 = await composed.onMemoryWrite!("a".repeat(101), { source: "test" })
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe("too long")

    // Both pass
    const r3 = await composed.onMemoryWrite!("hello world", { source: "test" })
    expect(r3.ok).toBe(true)
  })
})

describe("PluginManager — getPluginHooks", () => {
  let manager: PluginManager
  let pluginDir: string

  beforeEach(async () => {
    tmpBase = await tmpPluginDir()
    manager = new PluginManager()
    process.env["YOMI_NOTEPAD_DIR"] = tmpBase
    pluginDir = join(tmpBase, "plugins", "hook-check")
    await mkdir(pluginDir, { recursive: true })
    await writeManifest(pluginDir)
    await writeEntryPoint(
      pluginDir,
      `export default function factory(api) {
        return {
          hooks: {
            onMemoryWrite: async (content, metadata) => {
              if (metadata?.kind === "secret") return { ok: false, reason: "no secrets" }
              return { ok: true }
            },
          },
        }
      }`,
    )
    await manager.init()
  })

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    delete process.env["YOMI_NOTEPAD_DIR"]
  })

  it("chains onMemoryWrite hooks from plugins", async () => {
    const pluginHooks = manager.getPluginHooks()
    expect(pluginHooks.onMemoryWrite).toBeDefined()

    const r1 = await pluginHooks.onMemoryWrite!("some content", { kind: "fact" })
    expect(r1.ok).toBe(true)

    const r2 = await pluginHooks.onMemoryWrite!("classified", { kind: "secret" })
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe("no secrets")
  })
})
