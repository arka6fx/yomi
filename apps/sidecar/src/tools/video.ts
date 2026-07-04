import { tool, jsonSchema } from "ai"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text"
const MAX_VIDEO_BYTES = 200 * 1024 * 1024

function apiKey(): string {
  const k = process.env["ELEVENLABS_API_KEY"]
  if (!k) throw new Error("ELEVENLABS_API_KEY not set")
  return k
}

async function downloadFile(url: string, maxBytes = MAX_VIDEO_BYTES): Promise<{ buffer: ArrayBuffer; ext: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > maxBytes) throw new Error(
    `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(0)} MB, max ${maxBytes / 1024 / 1024} MB)`
  )
  const contentType = res.headers.get("content-type") ?? ""
  const ext = url.split(".").pop()?.toLowerCase() ?? "mp4"
  return { buffer, ext }
}

async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" })
    proc.on("error", () => resolve(false))
    proc.on("close", (code) => resolve(code === 0))
  })
}

async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", videoPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-ab", "128k",
      "-y",
      audioPath,
    ], { stdio: "pipe" })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}

async function extractFrames(videoPath: string, outputDir: string, count: number): Promise<string[]> {
  // Use fps filter: evenly space frames across the video duration
  // ffmpeg -i input.mp4 -vf "fps=1/(duration/frameCount)" -q:v 2 frame%03d.jpg
  return new Promise((resolve, reject) => {
    const fps = 1 / Math.max(1, count)
    const proc = spawn("ffmpeg", [
      "-i", videoPath,
      "-vf", `fps=${fps}`,
      "-q:v", "2",
      "-y",
      join(outputDir, "frame-%03d.jpg"),
    ], { stdio: "pipe" })
    proc.on("error", reject)
    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`))
        return
      }
      const { readdir } = await import("node:fs/promises")
      const files = (await readdir(outputDir))
        .filter((f) => f.startsWith("frame-"))
        .sort()
        .slice(0, count)
      resolve(files.map((f) => join(outputDir, f)))
    })
  })
}

export function createVideoTools() {
  return {
    transcribe_video: tool({
      description:
        "Transcribe speech from a video file using ElevenLabs. " +
        "Downloads the video, extracts the audio track (requires system ffmpeg), " +
        "and sends it to the speech-to-text API. Returns the transcript text.",
      parameters: jsonSchema<{ url: string }>({
        type: "object",
        properties: {
          url: { type: "string", description: "Direct download URL of the video file" },
        },
        required: ["url"],
      }),
      execute: async ({ url }) => {
        try {
          const hasFfmpeg = await ffmpegAvailable()
          const { buffer, ext } = await downloadFile(url)
          const key = apiKey()

          if (hasFfmpeg) {
            // Extract audio with ffmpeg, then transcribe
            const tmpDir = await mkdtemp(join(tmpdir(), "yomi-video-"))
            const videoPath = join(tmpDir, `input.${ext}`)
            const audioPath = join(tmpDir, "audio.mp3")
            await writeFile(videoPath, Buffer.from(buffer))

            try {
              await extractAudio(videoPath, audioPath)
              const audioBuf = await readFile(audioPath)
              const form = new FormData()
              form.append("model_id", "scribe_v2")
              form.append("file", new Blob([audioBuf], { type: "audio/mpeg" }), "audio.mp3")
              const res = await fetch(ELEVENLABS_URL, {
                method: "POST",
                headers: { "xi-api-key": key },
                body: form,
              })
              if (!res.ok) {
                const body = await res.text()
                return { error: `ElevenLabs STT ${res.status}: ${body.slice(0, 200)}` }
              }
              const data = (await res.json()) as { text?: string }
              const text = data.text?.trim() ?? ""
              return text ? { text } : { error: "No speech detected in the video." }
            } finally {
              rm(tmpDir, { recursive: true, force: true }).catch(() => {})
            }
          } else {
            // Try sending the video directly — modern STT APIs often handle it
            const form = new FormData()
            form.append("model_id", "scribe_v2")
            form.append("file", new Blob([buffer], { type: "video/mp4" }), `video.${ext}`)
            const res = await fetch(ELEVENLABS_URL, {
              method: "POST",
              headers: { "xi-api-key": key },
              body: form,
            })
            if (!res.ok) {
              const body = await res.text()
              if (res.status === 422 || body.includes("audio")) {
                return {
                  error:
                    "This video needs audio extraction, but ffmpeg is not installed. " +
                    "Install ffmpeg (https://ffmpeg.org/download.html) and try again.",
                }
              }
              return { error: `ElevenLabs STT ${res.status}: ${body.slice(0, 200)}` }
            }
            const data = (await res.json()) as { text?: string }
            const text = data.text?.trim() ?? ""
            return text ? { text } : { error: "No speech detected in the video." }
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    sample_video_frames: tool({
      description:
        "Extract frames from a video file for vision-based Q&A. " +
        "Requires ffmpeg installed on the system. Returns an array of base64-encoded " +
        "JPEG images you can pass to a vision model for analysis.",
      parameters: jsonSchema<{ url: string; count?: number }>({
        type: "object",
        properties: {
          url: { type: "string", description: "Direct download URL of the video file" },
          count: {
            type: "number",
            description: "Number of frames to extract (default 5, max 20)",
            default: 5,
          },
        },
        required: ["url"],
      }),
      execute: async ({ url, count }) => {
        const frameCount = Math.min(Math.max(count ?? 5, 1), 20)
        try {
          const hasFfmpeg = await ffmpegAvailable()
          if (!hasFfmpeg) {
            return { error: "ffmpeg is required for frame extraction. Install from https://ffmpeg.org/download.html and try again." }
          }

          const { buffer, ext } = await downloadFile(url)
          const tmpDir = await mkdtemp(join(tmpdir(), "yomi-frames-"))
          const videoPath = join(tmpDir, `input.${ext}`)
          await writeFile(videoPath, Buffer.from(buffer))

          try {
            const framePaths = await extractFrames(videoPath, tmpDir, frameCount)
            if (framePaths.length === 0) {
              return { error: "No frames could be extracted from the video." }
            }
            const frames: string[] = []
            for (const fp of framePaths) {
              const buf = await readFile(fp)
              frames.push(`data:image/jpeg;base64,${buf.toString("base64")}`)
            }
            return {
              frames,
              count: frames.length,
              note: frameCount > frames.length
                ? `Requested ${frameCount} frames but only ${frames.length} were extracted (video may be shorter than expected).`
                : undefined,
            }
          } finally {
            rm(tmpDir, { recursive: true, force: true }).catch(() => {})
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),
  }
}
