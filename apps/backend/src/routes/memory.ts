import { Hono } from "hono"
import { authenticate } from "../auth.js"

// Memory sync routes — Phase 3+
// DB stores metadata (path, content_hash, size_bytes); actual content goes in object storage.
export const memoryRouter = new Hono()

memoryRouter.get("/", authenticate, async (c) => {
  return c.json({ error: "Memory sync not yet implemented" }, 501)
})

memoryRouter.get("/:path{.+}", authenticate, async (c) => {
  return c.json({ error: "Memory sync not yet implemented" }, 501)
})

memoryRouter.put("/:path{.+}", authenticate, async (c) => {
  return c.json({ error: "Memory sync not yet implemented" }, 501)
})
