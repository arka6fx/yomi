// Plugin manager — discovers, loads, and manages plugins.
// Scans three sources (bundled, user, project) and supports:
//   - plugin.json / plugin.yaml manifest
//   - index.ts entry point (factory function)
//   - tools/*.ts auto-discovery (each file = one tool)
//   - hooks.ts auto-discovery (lifecycle hooks)

import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { tool, jsonSchema } from "ai"
import type { ToolSet } from "ai"
import type { Hooks } from "../harness/hooks.js"
import { notepadDir } from "../memory/loader.js"
import {
  validateManifest,
  type PluginManifest,
  type PluginToolDef,
  type PluginAPI,
  type PluginDefinition,
  type PluginFactory,
  type PluginRegistration,
  type PluginCLICommand,
  type PluginNotepadProvider,
  type PluginDiscoverySource,
  PLUGIN_DISCOVERY_SOURCES,
} from "./plugin-types.js"

const PLUGINS_DIR_NAME = "plugins"

function userPluginsPath(): string {
  return join(notepadDir(), PLUGINS_DIR_NAME)
}

// ---- Bundled plugins ----

function bundledPluginsPaths(): string[] {
  const candidates: string[] = []

  // 1. Env override
  const env = process.env["YOMI_BUNDLED_PLUGINS_DIR"]
  if (env) candidates.push(env)

  // 2. Relative to this source file (dev):
  //    src/plugins/plugin-manager.ts -> <root>/plugins/
  try {
    const dev = join(import.meta.dir, "..", "..", "plugins")
    candidates.push(dev)
  } catch {
    // import.meta.dir may not be available in all runtimes
  }

  // 3. Relative to compiled binary (production):
  //    <bin>/../plugins/
  try {
    const prod = join(process.execPath, "..", "plugins")
    candidates.push(prod)
  } catch {
    // process.execPath may not be available
  }

  return candidates
}

async function resolveBundledPluginsDir(): Promise<string | null> {
  for (const candidate of bundledPluginsPaths()) {
    try {
      await stat(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

// ---- Project plugins (.yomi/plugins/) ----

async function resolveProjectPluginsDir(): Promise<string | null> {
  try {
    const candidate = join(process.cwd(), ".yomi", PLUGINS_DIR_NAME)
    await stat(candidate)
    return candidate
  } catch {
    return null
  }
}

// ---- Minimal YAML parser for plugin manifest ----

function parseYamlLine(line: string): [string, string] | null {
  const match = line.match(/^\s*(\w[\w-]*)\s*:\s*(.+)$/)
  if (!match) return null
  const value = match[2]!.replace(/^["']|["']$/g, "").trim()
  return [match[1]!, value]
}

function parsePluginManifestYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const line of text.split("\n")) {
    const kv = parseYamlLine(line)
    if (kv) result[kv[0]] = kv[1]
  }
  return result
}

// ---- PluginAPI factory ----

function createPluginAPI(cliTarget: PluginCLICommand[], npTarget: PluginNotepadProvider[]): PluginAPI {
  return {
    defineTool(def: PluginToolDef) {
      return {
        description: def.description,
        parameters: def.parameters,
        execute: async (args: Record<string, unknown>) => def.execute(args),
      }
    },
    defineCLICommand(def: PluginCLICommand) {
      cliTarget.push(def)
    },
    defineNotepadProvider(def: PluginNotepadProvider) {
      npTarget.push(def)
    },
    log: { info: console.warn, warn: console.warn, error: console.error },
    notepadDir: notepadDir(),
  }
}

// ---- Composite hooks ----

function composeHooks(...hooksList: Partial<Hooks>[]): Hooks {
  return {
    onSessionStart: async () => {
      for (const h of hooksList) {
        if (h.onSessionStart) await h.onSessionStart()
      }
    },
    onUserPromptSubmit: async (prompt) => {
      for (const h of hooksList) {
        if (h.onUserPromptSubmit) await h.onUserPromptSubmit(prompt)
      }
    },
    onPreToolUse: async (toolName, args) => {
      for (const h of hooksList) {
        if (h.onPreToolUse) {
          const result = await h.onPreToolUse(toolName, args)
          if (!result.ok) return result
        }
      }
      return { ok: true }
    },
    onPostToolUse: async (toolName, result, args) => {
      let current = result
      for (const h of hooksList) {
        if (h.onPostToolUse) {
          current = await h.onPostToolUse(toolName, current, args)
        }
      }
      return current
    },
    onMemoryWrite: async (content, metadata) => {
      for (const h of hooksList) {
        if (h.onMemoryWrite) {
          const r = await h.onMemoryWrite(content, metadata)
          if (!r.ok) return r
        }
      }
      return { ok: true }
    },
    onStop: async (summary) => {
      for (const h of hooksList) {
        if (h.onStop) await h.onStop(summary)
      }
    },
    onSessionEnd: async () => {
      for (const h of hooksList) {
        if (h.onSessionEnd) await h.onSessionEnd()
      }
    },
  }
}

// ---- PluginManager ----

export class PluginManager {
  private plugins: PluginRegistration[] = []
  private loaded = false

  async init(): Promise<void> {
    if (this.loaded) return
    const loaded: PluginRegistration[] = []

    for (const source of PLUGIN_DISCOVERY_SOURCES) {
      const dir = await this.resolveSourceDir(source)
      if (!dir) continue

      const entries = await this.readPluginDir(dir)
      if (!entries) continue

      for (const name of entries) {
        const pluginDir = join(dir, name)
        let st
        try {
          st = await stat(pluginDir)
        } catch {
          continue
        }
        if (!st.isDirectory()) continue

        // Skip if already loaded from a higher-priority source
        if (loaded.some((p) => p.manifest.name === name)) continue

        try {
          const reg = await this.loadPlugin(pluginDir, name, source)
          if (reg) {
            loaded.push(reg)
            console.warn(`[plugins] loaded "${name}" v${reg.manifest.version} (${source})`)
          }
        } catch (err) {
          console.warn(`[plugins] failed to load "${name}" from ${source}:`, err)
        }
      }
    }

    this.plugins = loaded
    this.loaded = true
    console.warn(`[plugins] ${loaded.length} plugin(s) loaded`)
  }

  private async resolveSourceDir(
    source: PluginDiscoverySource,
  ): Promise<string | null> {
    switch (source) {
      case "bundled":
        return resolveBundledPluginsDir()
      case "user":
        return userPluginsPath()
      case "project":
        return resolveProjectPluginsDir()
    }
  }

  private async readPluginDir(dir: string): Promise<string[] | null> {
    try {
      return await readdir(dir)
    } catch {
      return null
    }
  }

  private async loadPlugin(
    pluginDir: string,
    name: string,
    source: PluginDiscoverySource,
  ): Promise<PluginRegistration | null> {
    const manifest = await this.readManifest(pluginDir, name)
    if (!manifest) return null

    const tools: Record<string, PluginToolDef> = {}
    let hooks: Partial<Hooks> = {}
    const cliCommands: PluginCLICommand[] = []
    const notepadProviders: PluginNotepadProvider[] = []

    // 1. Try index.ts entry point (factory function)
    const entryPath = join(pluginDir, "index.ts")
    let hasEntry = false
    try {
      await stat(entryPath)
      hasEntry = true
    } catch {
      // no entry point
    }

    if (hasEntry) {
      const api = createPluginAPI(cliCommands, notepadProviders)
      const def = await this.loadEntryPoint(entryPath, api)
      if (def) {
        if (def.tools) {
          for (const [k, v] of Object.entries(def.tools)) {
            tools[k] = v
          }
        }
        if (def.hooks) hooks = def.hooks
      }
    }

    // 2. Auto-discover tools from tools/ directory
    const toolsDir = join(pluginDir, "tools")
    try {
      const toolFiles = await readdir(toolsDir)
      for (const file of toolFiles) {
        if (!file.endsWith(".ts")) continue
        const toolName = file.slice(0, -3) // strip .ts
        if (toolName in tools) continue // factory-defined takes precedence
        const toolDef = await this.loadToolFile(join(toolsDir, file), toolName)
        if (toolDef) tools[toolName] = toolDef
      }
    } catch {
      // No tools/ directory — fine
    }

    // 3. Auto-discover hooks from hooks.ts (if no entry point defined hooks)
    if (Object.keys(hooks).length === 0) {
      const hooksPath = join(pluginDir, "hooks.ts")
      try {
        await stat(hooksPath)
        const discovered = await this.loadHooksFile(hooksPath)
        if (discovered) hooks = discovered
      } catch {
        // No hooks.ts — fine
      }
    }

    return {
      manifest,
      tools,
      hooks,
      cliCommands,
      notepadProviders,
      dir: pluginDir,
      source,
    }
  }

  private async readManifest(
    pluginDir: string,
    name: string,
  ): Promise<PluginManifest | null> {
    for (const filename of ["plugin.json", "plugin.yaml"]) {
      try {
        const content = await readFile(join(pluginDir, filename), "utf-8")
        const raw = filename.endsWith(".json")
          ? (JSON.parse(content) as Record<string, unknown>)
          : parsePluginManifestYaml(content)
        return validateManifest({ ...raw, name: raw.name ?? name })
      } catch {
        continue
      }
    }
    return null
  }

  private async loadEntryPoint(
    entryPath: string,
    api: PluginAPI,
  ): Promise<PluginDefinition | null> {
    try {
      const mod = await import(entryPath)
      const factory: PluginFactory | undefined = mod.default ?? mod.factory
      if (typeof factory !== "function") {
        console.warn(`[plugins] entry point has no default export: ${entryPath}`)
        return null
      }
      return await factory(api)
    } catch (err) {
      console.warn(`[plugins] error loading entry point ${entryPath}:`, err)
      return null
    }
  }

  private async loadToolFile(
    filePath: string,
    toolName: string,
  ): Promise<PluginToolDef | null> {
    try {
      const mod = await import(filePath)
      const def: PluginToolDef | undefined = mod.default ?? mod.tool
      if (!def || typeof def.execute !== "function") {
        console.warn(`[plugins] tools/${toolName}.ts has no default export or tool export`)
        return null
      }
      return {
        description: def.description,
        parameters: def.parameters,
        execute: def.execute,
      }
    } catch (err) {
      console.warn(`[plugins] error loading tools/${toolName}.ts:`, err)
      return null
    }
  }

  private async loadHooksFile(
    filePath: string,
  ): Promise<Partial<Hooks> | null> {
    try {
      const mod = await import(filePath)
      return mod.default ?? mod.hooks ?? null
    } catch (err) {
      console.warn(`[plugins] error loading hooks.ts:`, err)
      return null
    }
  }

  // Convert plugin tools to an AI SDK ToolSet
  getTools(): ToolSet {
    const result: ToolSet = {}
    for (const reg of this.plugins) {
      for (const [name, def] of Object.entries(reg.tools)) {
        if (name in result) {
          console.warn(
            `[plugins] duplicate tool "${name}" from "${reg.manifest.name}", skipping`,
          )
          continue
        }
        result[name] = tool({
          description: def.description,
          parameters: jsonSchema<Record<string, unknown>>(
            def.parameters as Record<string, unknown>,
          ),
          execute: async (args) => {
            return await def.execute(args as Record<string, unknown>)
          },
        })
      }
    }
    return result
  }

  // Merge plugin hooks into a composite that feeds into the hook chain
  getPluginHooks(): Partial<Hooks> {
    const allHooks = this.plugins.map((p) => p.hooks)
    if (allHooks.length === 0) return {}

    return {
      onPreToolUse: async (toolName, args) => {
        for (const h of allHooks) {
          if (h.onPreToolUse) {
            const r = await h.onPreToolUse(toolName, args)
            if (!r.ok) return r
          }
        }
        return { ok: true }
      },
      onPostToolUse: async (toolName, result, args) => {
        let current = result
        for (const h of allHooks) {
          if (h.onPostToolUse) current = await h.onPostToolUse(toolName, current, args)
        }
        return current
      },
      onMemoryWrite: async (content, metadata) => {
        for (const h of allHooks) {
          if (h.onMemoryWrite) {
            const r = await h.onMemoryWrite(content, metadata)
            if (!r.ok) return r
          }
        }
        return { ok: true }
      },
      onSessionStart: async () => {
        for (const h of allHooks) {
          if (h.onSessionStart) await h.onSessionStart()
        }
      },
      onSessionEnd: async () => {
        for (const h of allHooks) {
          if (h.onSessionEnd) await h.onSessionEnd()
        }
      },
      onUserPromptSubmit: async (prompt) => {
        for (const h of allHooks) {
          if (h.onUserPromptSubmit) await h.onUserPromptSubmit(prompt)
        }
      },
      onStop: async (summary) => {
        for (const h of allHooks) {
          if (h.onStop) await h.onStop(summary)
        }
      },
    }
  }

  getCLICommands(): PluginCLICommand[] {
    return this.plugins.flatMap((p) => p.cliCommands)
  }

  getNotepadProviders(): PluginNotepadProvider[] {
    return this.plugins.flatMap((p) => p.notepadProviders)
  }

  getPluginCount(): number {
    return this.plugins.length
  }

  getPluginNames(): string[] {
    return this.plugins.map((p) => p.manifest.name)
  }

  getPlugin(name: string): PluginRegistration | undefined {
    return this.plugins.find((p) => p.manifest.name === name)
  }

  listPlugins(): PluginRegistration[] {
    return [...this.plugins]
  }

  async shutdown(): Promise<void> {
    this.plugins = []
    this.loaded = false
  }
}

// ---- Singleton ----

let defaultManager: PluginManager | null = null

export function getDefaultPluginManager(): PluginManager {
  if (!defaultManager) defaultManager = new PluginManager()
  return defaultManager
}

export { composeHooks }
