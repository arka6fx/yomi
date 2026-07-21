import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "@yomi/db"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"

export const profileRouter = new Hono()

type ProfileBody = {
  name?: string
  agentSoul?: string
}

// Lightweight session check — returns 200 with basic user info if token is valid, 401 otherwise
profileRouter.get("/me", authenticate, (c) => {
  const user = c.get("user")
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    role: user.role,
    agentSoul: user.agentSoul,
  })
})

profileRouter.patch("/profile", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ProfileBody

  if (body.name === undefined && body.agentSoul === undefined) {
    return c.json({ error: "name or agentSoul is required", code: "invalid_body" }, 400)
  }

  const update: { name?: string; agentSoul?: string } = {}

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) {
      return c.json({ error: "Name is required", code: "invalid_name" }, 400)
    }
    if (name.length > 80) {
      return c.json({ error: "Name must be 80 characters or fewer", code: "invalid_name" }, 400)
    }
    update.name = name
  }

  if (body.agentSoul !== undefined) {
    const agentSoul = body.agentSoul.trim()
    if (agentSoul.length > 2000) {
      return c.json(
        { error: "Writing style must be 2000 characters or fewer", code: "invalid_agent_soul" },
        400,
      )
    }
    update.agentSoul = agentSoul
  }

  const [updated] = await db
    .update(authSchema.user)
    .set(update)
    .where(eq(authSchema.user.id, user.id))
    .returning({
      name: authSchema.user.name,
      email: authSchema.user.email,
      agentSoul: authSchema.user.agentSoul,
    })

  if (!updated) return c.json({ error: "User not found" }, 404)

  return c.json(updated)
})
