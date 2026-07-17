import type { Context } from "hono"

// STT/TTS routes are authenticated via a shared secret to prevent abuse.
export function isSpeechAuthorized(c: Context): boolean {
  const secret = process.env["SIDECAR_SECRET"]

  // No secret configured: allow only outside production. The old check compared the header
  // to an undefined secret and let *any* anonymous caller through, so losing this env var
  // on the box would have silently turned both speech routes into open relays.
  if (!secret) return process.env["NODE_ENV"] !== "production"

  return c.req.header("x-sidecar-secret") === secret
}
