// Desktop automation not shipping. See AGENTS.md.
import type { Provider } from "./types.js"

export const nativeProvider: Provider = {
  id: "native",
  label: "Native Automation",
  healthCheck: async () => ({ ok: false, detail: "native automation not available" }),
  diagnostics: async () => ({ available: false }),
  repair: async () => ({ ok: false, detail: "native automation not available" }),
}
