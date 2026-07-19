import type { CapabilityManifest } from "./capabilities.js"

// A third-party plugin's registration record — the declaration side of the
// capability system (issue #75). Describes what the plugin is and what it needs
// to run; there is no runtime or sandbox here, only the declared metadata.
export interface PluginDef {
  id: string // stable, caller-supplied identifier (like a connector id)
  name: string // human-readable display name
  version: string // semver of the registered build
  capabilities: CapabilityManifest // what the plugin requires / optionally uses
  entrypoint: string // module path or URL the future runtime would load
}
