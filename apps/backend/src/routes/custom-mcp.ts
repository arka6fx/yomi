import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, customMcpServers } from "@yomi/db"
import { authenticate } from "../auth.js"
import { encryptString } from "../services/token-encryption.js"

export function validateCustomMcpServerInput(input: {
  name?: string
  url?: string
}): string | null {
  if (!input.name?.trim() || !input.url?.trim()) return "name and url are required"
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return "url must be a valid URL"
  }
  if (parsed.protocol !== "https:") return "url must use https"
  return null
}

export function isDuplicateUrlError(err: unknown): boolean {
  return String(err).includes("custom_mcp_servers_user_url_unique")
}

export const customMcpRouter = new Hono()

customMcpRouter.get("/", authenticate, async (c) => {
  const userId = c.get("user").id
  const rows = await db
    .select({ id: customMcpServers.id, name: customMcpServers.name, url: customMcpServers.url })
    .from(customMcpServers)
    .where(eq(customMcpServers.userId, userId))
  return c.json({ servers: rows })
})

customMcpRouter.post("/", authenticate, async (c) => {
  const userId = c.get("user").id
  const body = (await c.req.json()) as { name?: string; url?: string; apiKey?: string }
  const validationError = validateCustomMcpServerInput(body)
  if (validationError) return c.json({ error: validationError }, 400)

  try {
    const [row] = await db
      .insert(customMcpServers)
      .values({
        userId,
        name: body.name!.trim(),
        url: body.url!.trim(),
        apiKeyEncrypted: body.apiKey?.trim() ? encryptString(body.apiKey.trim()) : null,
      })
      .returning({
        id: customMcpServers.id,
        name: customMcpServers.name,
        url: customMcpServers.url,
      })
    return c.json({ server: row }, 201)
  } catch (err) {
    if (isDuplicateUrlError(err)) {
      return c.json({ error: "You've already added a server with this URL" }, 409)
    }
    throw err
  }
})

customMcpRouter.delete("/:id", authenticate, async (c) => {
  const userId = c.get("user").id
  const id = c.req.param("id")
  if (!id) return c.json({ error: "id is required" }, 400)
  await db
    .delete(customMcpServers)
    .where(and(eq(customMcpServers.id, id), eq(customMcpServers.userId, userId)))
  return c.json({ ok: true })
})
