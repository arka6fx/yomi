// ── Browser automation provider — will provide later ───────────────────────
// import type { Provider, ProviderHealth } from "./types.js"
// 
// const BROWSER_MODEL = process.env.AI_CREDITS_AGENT_MODEL || "gpt-4.1"
// 
// export const browserProvider: Provider = {
//   id: "browser",
//   label: "Browser (Playwright)",
//   async healthCheck(): Promise<ProviderHealth> { ... },
//   async diagnostics(): Promise<Record<string, unknown>> { ... },
//   async repair(): Promise<ProviderHealth> { ... },
// }
