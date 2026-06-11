import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseStreamCommandInput,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime"
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1Message,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider"

const DEFAULT_REGION = "us-east-1"
const DEFAULT_MODEL = "minimax.minimax-m2.5"

let client: BedrockRuntimeClient | null = null

function getClient(): BedrockRuntimeClient {
  if (client) return client
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS Bedrock credentials are missing")
  }
  client = new BedrockRuntimeClient({
    region: process.env.AWS_BEDROCK_REGION || DEFAULT_REGION,
    credentials: { accessKeyId, secretAccessKey },
  })
  return client
}

function textBlock(text: string): ContentBlock {
  return { text }
}

function imageFormat(mimeType?: string): "png" | "jpeg" | "gif" | "webp" {
  if (mimeType?.includes("png")) return "png"
  if (mimeType?.includes("gif")) return "gif"
  if (mimeType?.includes("webp")) return "webp"
  return "jpeg"
}

function messageText(message: LanguageModelV1Message): string {
  if (message.role === "system") return message.content
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "reasoning") return part.text
      if (part.type === "tool-call") return `Tool call ${part.toolName}: ${JSON.stringify(part.args)}`
      if (part.type === "tool-result") return `Tool result ${part.toolName}: ${JSON.stringify(part.result)}`
      if (part.type === "file") return `[file: ${part.mimeType}]`
      if (part.type === "image") return "[image]"
      if (part.type === "redacted-reasoning") return "[redacted reasoning]"
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function contentBlocks(message: LanguageModelV1Message): ContentBlock[] {
  if (message.role === "system") return [textBlock(message.content)]
  const blocks: ContentBlock[] = []
  for (const part of message.content) {
    if (part.type === "text") {
      blocks.push(textBlock(part.text))
    } else if (part.type === "image" && part.image instanceof Uint8Array) {
      blocks.push({
        image: {
          format: imageFormat(part.mimeType),
          source: { bytes: part.image },
        },
      })
    } else if (part.type === "image") {
      blocks.push(textBlock("[image omitted: unsupported URL image]"))
    } else {
      const text = messageText({ ...message, content: [part] } as LanguageModelV1Message)
      if (text) blocks.push(textBlock(text))
    }
  }
  return blocks.length > 0 ? blocks : [textBlock("")]
}

function bedrockPrompt(options: LanguageModelV1CallOptions): {
  system: SystemContentBlock[]
  messages: Message[]
} {
  const system: SystemContentBlock[] = []
  const messages: Message[] = []

  for (const message of options.prompt) {
    if (message.role === "system") {
      system.push({ text: message.content })
      continue
    }
    if (message.role === "tool") {
      messages.push({ role: "user", content: [textBlock(messageText(message))] })
      continue
    }
    messages.push({
      role: message.role,
      content: contentBlocks(message),
    })
  }

  if (options.responseFormat?.type === "json") {
    system.push({
      text: "Return only valid JSON. Do not wrap the JSON in markdown.",
    })
  }

  return { system, messages }
}

function finishReason(reason?: string): "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" {
  if (reason === "max_tokens") return "length"
  if (reason === "stop_sequence" || reason === "end_turn") return "stop"
  if (reason === "tool_use") return "tool-calls"
  if (reason === "content_filtered" || reason === "guardrail_intervened") return "content-filter"
  return "other"
}

function inferenceConfig(options: LanguageModelV1CallOptions) {
  return {
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    topP: options.topP,
    stopSequences: options.stopSequences,
  }
}

function warnings(options: LanguageModelV1CallOptions): LanguageModelV1CallWarning[] {
  if (options.mode.type === "regular" && options.mode.tools?.length) return []
  return []
}

function requestBody(modelId: string, options: LanguageModelV1CallOptions): ConverseCommandInput {
  const prompt = bedrockPrompt(options)
  return {
    modelId,
    system: prompt.system.length > 0 ? prompt.system : undefined,
    messages: prompt.messages,
    inferenceConfig: inferenceConfig(options),
  }
}

function tokenUsage(inputTokens?: number, outputTokens?: number) {
  return {
    promptTokens: inputTokens ?? 0,
    completionTokens: outputTokens ?? 0,
  }
}

function rawSettings(body: ConverseCommandInput | ConverseStreamCommandInput): Record<string, unknown> {
  return {
    modelId: body.modelId,
    system: body.system,
    messages: body.messages,
    inferenceConfig: body.inferenceConfig,
  }
}

function bedrockError(error: unknown, modelId: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/operation not allowed/i.test(message)) {
    return new Error(
      `AWS Bedrock MiniMax invocation is not allowed for ${modelId}. Enable model access and bedrock:InvokeModel/bedrock:InvokeModelWithResponseStream permissions.`,
    )
  }
  if (/credentials/i.test(message)) return new Error(message)
  return error instanceof Error ? error : new Error(message)
}

export function createModel(modelId = DEFAULT_MODEL): LanguageModelV1 {
  return {
    specificationVersion: "v1",
    provider: "aws-bedrock",
    modelId,
    defaultObjectGenerationMode: "json",
    supportsImageUrls: false,
    supportsStructuredOutputs: false,

    async doGenerate(options) {
      const body = requestBody(modelId, options)
      const response = await getClient()
        .send(new ConverseCommand(body), {
          abortSignal: options.abortSignal,
        })
        .catch((error) => {
          throw bedrockError(error, modelId)
        })
      const text = response.output?.message?.content?.map((part) => part.text ?? "").join("") ?? ""
      return {
        text,
        finishReason: finishReason(response.stopReason),
        usage: tokenUsage(response.usage?.inputTokens, response.usage?.outputTokens),
        rawCall: { rawPrompt: options.prompt, rawSettings: rawSettings(body) },
        rawResponse: { body: response },
        response: { modelId },
        warnings: warnings(options),
      }
    },

    async doStream(options) {
      const body: ConverseStreamCommandInput = requestBody(modelId, options)
      const response = await getClient()
        .send(new ConverseStreamCommand(body), {
          abortSignal: options.abortSignal,
        })
        .catch((error) => {
          throw bedrockError(error, modelId)
        })
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          let stopReason: string | undefined
          let inputTokens = 0
          let outputTokens = 0
          controller.enqueue({ type: "response-metadata", timestamp: new Date(), modelId })
          try {
            for await (const event of response.stream ?? []) {
              const delta = event.contentBlockDelta?.delta?.text
              if (delta) controller.enqueue({ type: "text-delta", textDelta: delta })
              if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason
              if (event.metadata?.usage) {
                inputTokens = event.metadata.usage.inputTokens ?? inputTokens
                outputTokens = event.metadata.usage.outputTokens ?? outputTokens
              }
            }
            controller.enqueue({
              type: "finish",
              finishReason: finishReason(stopReason),
              usage: tokenUsage(inputTokens, outputTokens),
            })
            controller.close()
          } catch (error) {
            controller.enqueue({ type: "error", error })
            controller.close()
          }
        },
      })

      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: rawSettings(body) },
        warnings: warnings(options),
      }
    },
  }
}
