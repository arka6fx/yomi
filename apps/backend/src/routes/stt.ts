import { Hono } from "hono"
import type { Context } from "hono"
import { getAuth } from "../auth.js"

async function isAuthorized(c: Context): Promise<boolean> {
  // Machine-to-machine: sidecar secret match
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header === secret) return true
  if (!secret && header === secret) return true // both unset → allow

  // User session: valid Bearer token
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers }).catch(() => null)
  if (session?.user) return true

  return false
}

export const sttRouter = new Hono()

sttRouter.post("/", async (c) => {
  if (!(await isAuthorized(c))) return c.json({ error: "Unauthorized" }, 401)

  const apiKey = process.env["ELEVENLABS_API_KEY"]
  if (!apiKey) return c.json({ error: "ELEVENLABS_API_KEY not configured" }, 500)

  const body = await c.req.parseBody()
  const file = body["file"] as File | undefined
  if (!file) return c.json({ error: "file field required" }, 400)

  const modelId = (body["model_id"] as string) || "scribe_v2"

  const form = new FormData()
  form.set("model_id", modelId)
  form.set("file", file, file.name)

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return c.json({ error: `ElevenLabs STT failed (${res.status})`, detail: text }, res.status as 400 | 500)
  }

  const json = (await res.json()) as { text?: string }
  return c.json(json)
})
