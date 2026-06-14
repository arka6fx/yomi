import type { BackendConnectorDef } from "./types.js"

const defs = new Map<string, BackendConnectorDef>()

export function registerConnectorDef(def: BackendConnectorDef): void {
  defs.set(def.id, def)
}

export function getConnectorDef(id: string): BackendConnectorDef | undefined {
  return defs.get(id)
}

export function getAllConnectorDefs(): BackendConnectorDef[] {
  return Array.from(defs.values())
}
