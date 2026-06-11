import { randomUUID } from "crypto"
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  type InvokeModelWithBidirectionalStreamInput,
} from "@aws-sdk/client-bedrock-runtime"

const MODEL_ID = "amazon.nova-2-sonic-v1:0"

let client: BedrockRuntimeClient

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return client
}

function eventBytes(obj: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj))
}

function eventChunk(obj: Record<string, unknown>): InvokeModelWithBidirectionalStreamInput {
  return { chunk: { bytes: eventBytes(obj) } }
}

function createInputStream() {
  const queue: InvokeModelWithBidirectionalStreamInput[] = []
  const waiters: Array<() => void> = []
  let closed = false

  function wake() {
    waiters.shift()?.()
  }

  return {
    send(event: Record<string, unknown>) {
      if (closed) return
      queue.push(eventChunk(event))
      wake()
    },
    close() {
      closed = true
      wake()
    },
    async *body(): AsyncGenerator<InvokeModelWithBidirectionalStreamInput> {
      while (!closed || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>(resolve => waiters.push(resolve))
          continue
        }
        yield queue.shift()!
      }
    },
  }
}

function stripWavHeader(audio: Uint8Array): Uint8Array {
  if (
    audio[0] === 0x52 && audio[1] === 0x49 &&
    audio[2] === 0x46 && audio[3] === 0x46
  ) {
    return audio.slice(44)
  }
  return audio
}

const audioInputConfig = {
  encoding: "base64",
  mediaType: "audio/lpcm",
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
  audioType: "SPEECH",
} as const

const audioOutputConfig = {
  ...audioInputConfig,
  sampleRateHertz: 24000,
  voiceId: "matthew",
}

const textConfig = {
  mediaType: "text/plain",
} as const

function sessionStartEvent(extra?: Record<string, unknown>) {
  return {
    event: {
      sessionStart: {
        inferenceConfiguration: {
          maxTokens: 1024,
          topP: 0.9,
          temperature: 0.7,
        },
        ...extra,
      },
    },
  }
}

function promptStartEvent(promptName: string) {
  return {
    event: {
      promptStart: {
        promptName,
        textOutputConfiguration: textConfig,
        audioOutputConfiguration: audioOutputConfig,
      },
    },
  }
}

function contentStartEvent(
  promptName: string,
  contentName: string,
  type: "AUDIO" | "TEXT",
  role: "SYSTEM" | "USER" = "USER",
  interactive = true,
) {
  return {
    event: {
      contentStart: {
        promptName,
        contentName,
        type,
        role,
        interactive,
        ...(type === "AUDIO"
          ? { audioInputConfiguration: audioInputConfig }
          : { textInputConfiguration: textConfig }),
      },
    },
  }
}

function systemPromptEvents(promptName: string) {
  const contentName = randomUUID()
  return [
    contentStartEvent(promptName, contentName, "TEXT", "SYSTEM", false),
    textInputEvent(promptName, contentName, "You are a helpful assistant. Keep responses brief."),
    contentEndEvent(promptName, contentName),
  ]
}

function audioInputEvent(promptName: string, contentName: string, content: string) {
  return {
    event: {
      audioInput: { promptName, contentName, content },
    },
  }
}

function textInputEvent(promptName: string, contentName: string, content: string) {
  return {
    event: {
      textInput: { promptName, contentName, content },
    },
  }
}

function contentEndEvent(promptName: string, contentName: string) {
  return {
    event: { contentEnd: { promptName, contentName } },
  }
}

function promptEndEvent(promptName: string) {
  return { event: { promptEnd: { promptName } } }
}

function sessionEndEvent() {
  return { event: { sessionEnd: {} } }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function* silenceAudioEvents(promptName: string, contentName: string) {
  const silence = Buffer.alloc(1024).toString("base64")
  yield contentStartEvent(promptName, contentName, "AUDIO", "USER", true)
  for (let i = 0; i < 30; i++) {
    yield audioInputEvent(promptName, contentName, silence)
    await sleep(32)
  }
  yield contentEndEvent(promptName, contentName)
}

async function nextWithTimeout<T>(iterator: AsyncIterator<T>, ms: number): Promise<IteratorResult<T> | null> {
  return Promise.race([
    iterator.next(),
    sleep(ms).then(() => null),
  ])
}

function errorMessage(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = value.message
    if (typeof message === "string") return message
  }
  return "unknown error"
}

function field(value: unknown, name: string): unknown {
  if (value && typeof value === "object" && name in value) {
    return value[name as keyof typeof value]
  }
  return undefined
}

function maybeThrowStreamError(item: unknown) {
  const validationException = field(item, "validationException")
  if (validationException) {
    throw new Error(`Nova Sonic validation error: ${errorMessage(validationException)}`)
  }
  const modelStreamErrorException = field(item, "modelStreamErrorException")
  if (modelStreamErrorException) {
    throw new Error(`Nova Sonic stream error: ${errorMessage(modelStreamErrorException)}`)
  }
  const internalServerException = field(item, "internalServerException")
  if (internalServerException) {
    throw new Error(`Nova Sonic internal error: ${errorMessage(internalServerException)}`)
  }
  const throttlingException = field(item, "throttlingException")
  if (throttlingException) {
    throw new Error(`Nova Sonic throttling error: ${errorMessage(throttlingException)}`)
  }
  const modelTimeoutException = field(item, "modelTimeoutException")
  if (modelTimeoutException) {
    throw new Error(`Nova Sonic timeout: ${errorMessage(modelTimeoutException)}`)
  }
  const serviceUnavailableException = field(item, "serviceUnavailableException")
  if (serviceUnavailableException) {
    throw new Error(`Nova Sonic unavailable: ${errorMessage(serviceUnavailableException)}`)
  }
}

function parseEvent(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes)).event
}

export interface NovaSonicSttResponse {
  text: string
}

export async function novaSonicTranscribe(
  audio: Uint8Array,
): Promise<NovaSonicSttResponse> {
  const promptName = randomUUID()
  const contentName = randomUUID()
  const pcm = stripWavHeader(audio)
  const audioBase64 = Buffer.from(pcm).toString("base64")
  const stream = createInputStream()

  stream.send(sessionStartEvent())
  stream.send(promptStartEvent(promptName))
  for (const event of systemPromptEvents(promptName)) stream.send(event)
  stream.send(contentStartEvent(promptName, contentName, "AUDIO", "USER", true))
  stream.send(audioInputEvent(promptName, contentName, audioBase64))
  stream.send(contentEndEvent(promptName, contentName))

  const command = new InvokeModelWithBidirectionalStreamCommand({
    modelId: MODEL_ID,
    body: stream.body(),
  })

  const response = await getClient().send(command)

  let text = ""
  const iterator = response.body![Symbol.asyncIterator]()

  while (true) {
    const result = await nextWithTimeout(iterator, 15_000)
    if (!result) break
    if (result.done) break

    const item = result.value
    if (item.chunk?.bytes) {
      const event = parseEvent(item.chunk.bytes)
      if (event.textOutput?.content) {
        text += event.textOutput.content
      }
      if (text && event.contentEnd) break
    } else {
      maybeThrowStreamError(item)
    }
  }

  stream.send(promptEndEvent(promptName))
  stream.send(sessionEndEvent())
  stream.close()

  return { text }
}

export async function novaSonicSynthesize(text: string): Promise<Uint8Array> {
  const promptName = randomUUID()
  const contentName = randomUUID()
  const audioContentName = randomUUID()
  const stream = createInputStream()

  stream.send(sessionStartEvent())
  stream.send(promptStartEvent(promptName))
  for (const event of systemPromptEvents(promptName)) stream.send(event)
  stream.send(contentStartEvent(promptName, contentName, "TEXT", "USER", true))
  stream.send(textInputEvent(promptName, contentName, text))
  stream.send(contentEndEvent(promptName, contentName))

  const command = new InvokeModelWithBidirectionalStreamCommand({
    modelId: MODEL_ID,
    body: stream.body(),
  })

  const response = await getClient().send(command)

  const audioParts: Uint8Array[] = []
  let sawAudio = false

  const silenceTask = (async () => {
    for await (const event of silenceAudioEvents(promptName, audioContentName)) {
      stream.send(event)
    }
  })()

  const iterator = response.body![Symbol.asyncIterator]()

  while (true) {
    const result = await nextWithTimeout(iterator, 20_000)
    if (!result) break
    if (result.done) break

    const item = result.value
    if (item.chunk?.bytes) {
      const event = parseEvent(item.chunk.bytes)
      if (event.audioOutput?.content) {
        const audioBuf = Buffer.from(event.audioOutput.content, "base64")
        audioParts.push(new Uint8Array(audioBuf))
        sawAudio = true
      }
      if (sawAudio && event.contentEnd) {
        break
      }
    } else {
      maybeThrowStreamError(item)
    }
  }

  await silenceTask
  stream.send(promptEndEvent(promptName))
  stream.send(sessionEndEvent())
  stream.close()

  if (audioParts.length === 0) {
    throw new Error("Nova Sonic TTS returned no audio content")
  }

  const totalLength = audioParts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of audioParts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}
