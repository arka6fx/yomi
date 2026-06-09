// Plugin system types — manifests, API, definitions, capabilities.
//
// Three discovery sources (in priority order):
//   1. bundled — <app>/plugins/<name>/ (shipped with Yomi)
//   2. user    — ~/.yomi/plugins/<name>/ (installed by user)
//   3. project — .yomi/plugins/<name>/  (opt-in, per-project)

import type { Hooks } from "../harness/hooks.js"

// ---- Manifest ----

export interface PluginManifest {
  name: string
  description: string
  version: string
  author: string
}

// ---- Tool ----

export interface PluginToolDef {
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

// ---- CLI subcommand ----

export interface PluginCLICommand {
  name: string
  description: string
  run: (args: string[]) => Promise<void> | void
}

// ---- Notepad provider ----

export interface PluginNotepadProvider {
  name: string
  load: () => Promise<string> | string
}

// ---- Discovery source ----

export type PluginDiscoverySource = "bundled" | "user" | "project"

export const PLUGIN_DISCOVERY_SOURCES: readonly PluginDiscoverySource[] = [
  "bundled",
  "user",
  "project",
] as const

// ---- PluginAPI (given to every plugin factory) ----

export interface PluginAPI {
  defineTool(
    def: PluginToolDef,
  ): {
    description: string
    parameters: Record<string, unknown>
    execute: (args: Record<string, unknown>) => Promise<unknown>
  }
  defineCLICommand(def: PluginCLICommand): void
  defineNotepadProvider(def: PluginNotepadProvider): void
  log: Pick<Console, "info" | "warn" | "error">
  notepadDir: string
}

// ---- PluginDefinition (what a plugin factory returns) ----

export interface PluginDefinition {
  tools?: Record<string, PluginToolDef>
  hooks?: Partial<Hooks>
  cliCommands?: PluginCLICommand[]
  notepadProviders?: PluginNotepadProvider[]
}

// ---- PluginFactory ----

export type PluginFactory = (
  api: PluginAPI,
) => PluginDefinition | Promise<PluginDefinition>

// ---- PluginRegistration (internal manager state) ----

export interface PluginRegistration {
  manifest: PluginManifest
  tools: Record<string, PluginToolDef>
  hooks: Partial<Hooks>
  cliCommands: PluginCLICommand[]
  notepadProviders: PluginNotepadProvider[]
  dir: string
  source: PluginDiscoverySource
}

// ---- Validation ----

export function validateManifest(
  raw: Record<string, unknown>,
): PluginManifest {
  const name = String(raw.name ?? "")
  if (!name) throw new Error("plugin manifest missing 'name'")
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error(
      `invalid plugin name: "${name}" (lowercase, hyphens only)`,
    )
  return {
    name,
    description: String(raw.description ?? ""),
    version: String(raw.version ?? "0.0.1"),
    author: String(raw.author ?? "unknown"),
  }
}
