import { makeComposioLinearDef, type ConnectorDef } from "@yomi/agent-core"
import { createComposioRestExecutor } from "./composio-executor.js"

// Composio-backed defs the backend can serve, keyed by connector id, each wired
// with the real Composio executor. Passed to ConnectorRegistry, which uses a given
// entry ONLY when the connector is also flagged via COMPOSIO_CONNECTORS — so the
// native def stays in force until the flag flips.
export function buildComposioDefs(): Record<string, ConnectorDef> {
  const executor = createComposioRestExecutor()
  return {
    linear: makeComposioLinearDef(executor),
  }
}
