import { eq } from "drizzle-orm"
import { db, plugins } from "@yomi/db"
import {
  evaluateManifest,
  type PluginDef,
  type ManifestSatisfaction,
  type CapabilitySet,
} from "@yomi/shared"

export interface RegisteredPlugin {
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

// Registers a plugin's declared capability manifest (issue #75). Re-registering
// an existing `id` updates the row in place — plugins are singletons by id, so
// a version bump replaces the prior registration rather than duplicating it.
export async function registerPlugin(def: PluginDef): Promise<RegisteredPlugin> {
  const now = new Date()
  const values = {
    pluginId: def.id,
    name: def.name,
    version: def.version,
    entrypoint: def.entrypoint,
    requiredCapabilities: def.capabilities.required,
    optionalCapabilities: def.capabilities.optional,
    permissions: def.capabilities.permissions,
    updatedAt: now,
  }
  const [row] = await db
    .insert(plugins)
    .values(values)
    .onConflictDoUpdate({ target: plugins.pluginId, set: values })
    .returning()
  return row as RegisteredPlugin
}

export async function unregisterPlugin(pluginId: string): Promise<void> {
  await db.delete(plugins).where(eq(plugins.pluginId, pluginId))
}

export async function getPlugin(pluginId: string): Promise<RegisteredPlugin | null> {
  const [row] = await db.select().from(plugins).where(eq(plugins.pluginId, pluginId))
  return (row as RegisteredPlugin | undefined) ?? null
}

export async function listPlugins(): Promise<RegisteredPlugin[]> {
  return (await db.select().from(plugins)) as RegisteredPlugin[]
}

// Compares a registered plugin's declared manifest against a caller's granted
// capability set — the query side of the capability system (ADR-0005).
export async function checkPluginAccess(
  pluginId: string,
  granted: CapabilitySet,
): Promise<ManifestSatisfaction> {
  const plugin = await getPlugin(pluginId)
  if (!plugin) throw new Error(`Plugin not registered: ${pluginId}`)
  return evaluateManifest(
    {
      required: plugin.requiredCapabilities,
      optional: plugin.optionalCapabilities,
      permissions: plugin.permissions,
    },
    granted,
  )
}
