import type { SubAgent, ValidateContext, ValidationVerdict } from "./types.js"

async function validateBrowser(ctx: ValidateContext): Promise<ValidationVerdict> {
  try {
    const hwnd =
      (await ctx.uia.findWindow({ process: "chrome" })) ??
      (await ctx.uia.findWindow({ titleContains: "Chrome" })) ??
      (await ctx.uia.findWindow({ process: "msedge" })) ??
      (await ctx.uia.findWindow({ titleContains: "Edge" }))
    if (!hwnd) return "fail"
    const { window } = await ctx.uia.getWindowInfo({ hwnd })
    const title = (window || "").trim()
    if (!title) return "inconclusive"
    if (/^(new tab|about:blank)$/i.test(title)) return "fail"
    return "pass"
  } catch {
    return "inconclusive"
  }
}

export const browserAgent: SubAgent = {
  id: "browser",
  label: "Browser Agent",
  provider: "browser",
  toolPrefixes: ["browser_"],
  toolNames: ["look_at_screen", "web_search", "fetch_url", "open_user_chrome"],
  systemHint:
    "You are the browser agent. Treat the user's installed Chrome as first priority unless the user names a different browser. " +
    "For simple open/navigate/search requests, open_user_chrome is preferred because it uses the user's normal Chrome profile. " +
    "Use browser_* tools for deeper page automation that needs snapshots, refs, clicks, typing, or extraction.",
  validate: validateBrowser,
}
