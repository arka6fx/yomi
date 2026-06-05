import type { Provider } from "./types.js"

// ApiProvider: placeholder for direct-API integrations (calendar/email/Notion/etc.). Implements the
// interface so the registry is complete and the validation framework can report it; filled in later.
export const apiProvider: Provider = {
  id: "api",
  label: "API Provider",
  healthCheck: async () => ({ ok: true, detail: "no API integrations configured yet" }),
  diagnostics: async () => ({ integrations: [] }),
  repair: async () => ({ ok: true, detail: "nothing to repair" }),
}
