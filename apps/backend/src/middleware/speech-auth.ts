import type { Context } from "hono"

// Machine-to-machine only. STT/TTS are reached exclusively through the metered voice
// pipeline (desktop reserves `voice` → sidecar → backend), so a plain user session must
// NOT be able to call the speech providers directly and bypass the credit meter — see the
// "no meter bypass" tests in routes/proxy.test.ts.
export function isSpeechAuthorized(c: Context): boolean {
  const secret = process.env["SIDECAR_SECRET"]

  // No secret configured: allow only outside production. The old check compared the header
  // to an undefined secret and let *any* anonymous caller through, so losing this env var
  // on the box would have silently turned both speech routes into open relays.
  if (!secret) return process.env["NODE_ENV"] !== "production"

  return c.req.header("x-sidecar-secret") === secret
}
