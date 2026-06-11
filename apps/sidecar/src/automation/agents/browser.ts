// ── Browser agent — will provide later ─────────────────────────────────────
// import type { SubAgent, ValidateContext, ValidationVerdict } from "./types.js"
// 
// async function validateBrowser(ctx: ValidateContext): Promise<ValidationVerdict> { ... }
// 
// export const browserAgent: SubAgent = {
//   id: "browser",
//   label: "Browser Agent",
//   provider: "browser",
//   toolPrefixes: ["browser_"],
//   toolNames: ["look_at_screen", "web_search", "fetch_url", "open_user_chrome"],
//   systemHint: "...",
//   validate: validateBrowser,
// }
