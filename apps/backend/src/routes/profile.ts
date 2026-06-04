import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "@yomi/db"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"

export const profileRouter = new Hono()

type ProfileBody = {
  name?: string
}

profileRouter.patch("/profile", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ProfileBody
  const name = body.name?.trim()

  if (!name) {
    return c.json({ error: "Name is required", code: "invalid_name" }, 400)
  }

  if (name.length > 80) {
    return c.json({ error: "Name must be 80 characters or fewer", code: "invalid_name" }, 400)
  }

  const [updated] = await db
    .update(authSchema.user)
    .set({ name })
    .where(eq(authSchema.user.id, user.id))
    .returning({
      name: authSchema.user.name,
      email: authSchema.user.email,
    })

  if (!updated) return c.json({ error: "User not found" }, 404)

  return c.json(updated)
})
