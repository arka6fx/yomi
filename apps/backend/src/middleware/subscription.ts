import type { Context, Next } from "hono"

export type AccessKind = "chat" | "voice" | "agent"

// Local testing mode: Pro and Max share the same unrestricted access.
export function requireAccess(_kind: AccessKind) {
  return async (_c: Context, next: Next) => {
    return next()
  }
}
