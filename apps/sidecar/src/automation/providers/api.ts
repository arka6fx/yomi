import { getConnectorRegistry } from "../../connectors/registry.js"
import type { Provider } from "./types.js"

export const apiProvider: Provider = {
  id: "api",
  label: "API Provider",
  async healthCheck() {
    const connected = getConnectorRegistry().getConnected()
    return connected.length > 0
      ? { ok: true, detail: `${connected.length} integration(s) connected` }
      : { ok: true, detail: "no integrations connected" }
  },
  async diagnostics() {
    return { integrations: getConnectorRegistry().getConnected() }
  },
  async repair() {
    return { ok: true, detail: "nothing to repair" }
  },
}
