import type { SubAgent, ValidateContext, ValidationVerdict } from "./types.js"

// Spotify's window title is the now-playing line ("Artist · Song" / "Artist - Song") while a track is
// active, and bare "Spotify" / "Spotify Premium" / "Spotify Free" when idle or paused.
const IDLE_TITLE = /^spotify(\s+(premium|free))?$/i

async function validateSpotify(ctx: ValidateContext): Promise<ValidationVerdict> {
  try {
    const hwnd =
      (await ctx.uia.findWindow({ process: "Spotify" })) ??
      (await ctx.uia.findWindow({ titleContains: "Spotify" }))
    // Spotify isn't running at all — strong evidence a play/launch task did not land.
    if (!hwnd) return "fail"
    const { window } = await ctx.uia.getWindowInfo({ hwnd })
    const title = (window || "").trim()
    if (!title || IDLE_TITLE.test(title)) return "inconclusive" // idle/paused — let the rubric decide
    return "pass" // an actual track is showing in the title
  } catch {
    // Helper unreachable / not on Windows — can't tell, so don't fail a possibly-working flow.
    return "inconclusive"
  }
}

export const spotifyAgent: SubAgent = {
  id: "spotify",
  label: "Spotify Agent",
  provider: "native",
  toolNames: ["play_spotify", "control_spotify", "adjust_spotify_volume", "look_at_screen"],
  systemHint:
    "You are the Spotify agent. Use the dedicated Spotify tools (play_spotify, " +
    "control_spotify, adjust_spotify_volume) rather than driving the UI by hand. After acting, the " +
    "system verifies the now-playing state.",
  validate: validateSpotify,
}
