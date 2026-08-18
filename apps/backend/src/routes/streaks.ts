import { Hono } from "hono"
import { authenticate } from "../auth.js"
import { getLeaderboard, getStreakStats, setLeaderboardOptIn } from "../services/streaks.js"

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

streaksRouter.get("/leaderboard", async (c) => {
  const user = c.get("user")
  const result = await getLeaderboard(user.id)
  return c.json(result)
})
