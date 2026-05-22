import { Hono } from "hono"
import OpenAI, { toFile } from "openai"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] })

export const sttRouter = new Hono()

sttRouter.post("/", authenticate, async (c) => {
  const { audio_b64 } = await c.req.json() as { audio_b64: string }
  const user = c.get("user")

  const audioBuffer = Buffer.from(audio_b64, "base64")
  const model = process.env["STT_MODEL"] ?? "whisper-1"

  const transcript = await openai.audio.transcriptions.create({
    model,
    file: await toFile(audioBuffer, "audio.webm"),
  })

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: "stt",
    model,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  return c.json({ transcript: transcript.text })
})
