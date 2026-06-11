// ── Browser automation provider — will provide later ───────────────────────
// import type { Provider, ProviderHealth } from "./types.js"
// 
// const BROWSER_MODEL = process.env.AGENT_PATH_MODEL || "minimax.minimax-m2.5"
// 
// export const browserProvider: Provider = {
//   id: "browser",
//   label: "Browser (Playwright)",
//   async healthCheck(): Promise<ProviderHealth> { ... },
//   async diagnostics(): Promise<Record<string, unknown>> { ... },
//   async repair(): Promise<ProviderHealth> { ... },
// }
