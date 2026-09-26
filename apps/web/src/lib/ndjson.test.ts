import { describe, expect, it } from "vitest"
import { readNdjson } from "./ndjson"

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)))
      controller.close()
    },
  })
}

describe("readNdjson", () => {
  it("joins lines split across chunks and reads a last line with no newline", async () => {
    const events: unknown[] = []
    await readNdjson(
      streamOf('{"type":"te', 'xt","text":"hi"}\n{"type":"done"', ',"reply":"hi"}'),
      (e) => events.push(e),
    )
    expect(events).toEqual([
      { type: "text", text: "hi" },
      { type: "done", reply: "hi" },
    ])
  })
})
