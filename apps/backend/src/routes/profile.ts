import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "@yomi/db"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"
import { uploadAvatar } from "../services/asset-storage.js"
import { setLeaderboardShowPhoto, updateLeaderboardHandle } from "../services/streaks.js"

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

const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

profileRouter.post("/avatar", authenticate, async (c) => {
  const user = c.get("user")
  const contentType = c.req.header("content-type") ?? ""
  if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
    return c.json(
      { error: "Avatar must be a JPEG, PNG, GIF, or WEBP image", code: "invalid_avatar_type" },
      400,
    )
  }

  const bytes = await c.req.arrayBuffer()
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    return c.json({ error: "Avatar must be 5MB or smaller", code: "avatar_too_large" }, 400)
  }

  const uploaded = await uploadAvatar(user.id, bytes, contentType)
  if (!uploaded) {
    return c.json(
      { error: "Avatar storage isn't configured", code: "avatar_storage_unavailable" },
      503,
    )
  }

  await db
    .update(authSchema.user)
    .set({ customAvatarKey: uploaded.key })
    .where(eq(authSchema.user.id, user.id))

  return c.json({ avatarUrl: `/api/user/avatar/${user.id}` })
})

type HandleBody = { handle?: string }

profileRouter.post("/handle", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as HandleBody
  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return c.json({ error: "handle is required", code: "invalid_handle" }, 400)
  }
  const result = await updateLeaderboardHandle(user.id, body.handle)
  if (!result.ok) {
    return c.json({ error: result.error, code: "invalid_handle" }, 400)
  }
  return c.json({ leaderboardHandle: result.leaderboardHandle })
})

type ShowPhotoBody = { showPhoto?: boolean }

profileRouter.post("/show-photo", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ShowPhotoBody
  if (typeof body.showPhoto !== "boolean") {
    return c.json({ error: "showPhoto must be a boolean", code: "invalid_show_photo" }, 400)
  }
  const result = await setLeaderboardShowPhoto(user.id, body.showPhoto)
  return c.json(result)
})
