import { Hono } from "hono"
import { authenticate } from "../auth.js"
import {
  getLeaderboard,
  getStreakStats,
  setLeaderboardOptIn,
  setLeaderboardShowPhoto,
  updateLeaderboardHandle,
} from "../services/streaks.js"

export const streaksRouter = new Hono()

streaksRouter.use("*", authenticate)

streaksRouter.get("/me", async (c) => {
  const user = c.get("user")
  const stats = await getStreakStats(user.id)
  return c.json(stats)
})

type OptInBody = { optIn?: boolean }

streaksRouter.post("/opt-in", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as OptInBody
  if (typeof body.optIn !== "boolean") {
    return c.json({ error: "optIn must be a boolean", code: "invalid_opt_in" }, 400)
  }
  const result = await setLeaderboardOptIn(user.id, body.optIn)
  return c.json(result)
})

type HandleBody = { handle?: string }

streaksRouter.post("/handle", async (c) => {
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

streaksRouter.post("/show-photo", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ShowPhotoBody
  if (typeof body.showPhoto !== "boolean") {
    return c.json({ error: "showPhoto must be a boolean", code: "invalid_show_photo" }, 400)
  }
  const result = await setLeaderboardShowPhoto(user.id, body.showPhoto)
  return c.json(result)
})

streaksRouter.get("/leaderboard", async (c) => {
  const user = c.get("user")
  const result = await getLeaderboard(user.id)
  return c.json(result)
})
