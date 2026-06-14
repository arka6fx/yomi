import type { ToolSet } from "ai"
import type { ConnectorRegistry } from "./connectors/registry.js"

// Returns the merged AI SDK tool set for all connected integrations.
// Tool implementations live in each connector's ConnectorDef.tools() factory.
export function createConnectorTools(registry: ConnectorRegistry): ToolSet {
  return registry.getAllDefTools()
}
