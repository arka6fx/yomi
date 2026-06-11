import { Hono } from "hono"

export const llmRouter = new Hono()

llmRouter.post("/stream", (c) =>
  c.json(
    {
      error:
        "Backend LLM proxy is disabled. Use the local sidecar AI Credits path.",
    },
    410,
  ),
)
