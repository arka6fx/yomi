import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1FunctionTool,
  LanguageModelV1Message,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider"

const DEFAULT_MODEL = "gpt-5.5"
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const DEFAULT_BASE_URL = "https://api.openai.com/v1"

type ToolCallObject = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

type ChatMessage =
  | {
      role: "system" | "user"
      content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>
    }
  | {
      role: "assistant"
      content: string | null
      tool_calls?: ToolCallObject[]
    }
  | {
      role: "tool"
      tool_call_id: string
      content: string
    }

type ChatCompletionResponse = {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: ToolCallObject[]
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

type ChatCompletionChunk = {
  model?: string
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: "function"
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  } | null
}

function baseUrl(): string {
  return (process.env["AI_CREDITS_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

function apiKey(): string {
  return process.env["AI_CREDITS_API_KEY"] ?? ""
}

function imageUrl(part: { image: unknown; mimeType?: string }): string {
  if (typeof part.image === "string") return part.image
  if (part.image instanceof URL) return part.image.toString()
  if (part.image instanceof Uint8Array) {
    const mime = part.mimeType || "image/jpeg"
    return `data:${mime};base64,${Buffer.from(part.image).toString("base64")}`
  }
  return "[image omitted: unsupported image input]"
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

type UserContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>

function userContent(message: Exclude<LanguageModelV1Message, { role: "system" }>): UserContent {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = []

  for (const part of message.content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text })
    } else if (part.type === "image") {
      const url = imageUrl(part)
      if (url.startsWith("[image omitted")) {
        parts.push({ type: "text", text: url })
      } else {
        parts.push({ type: "image_url", image_url: { url } })
      }
    } else {
      const text = messageText({ ...message, content: [part] } as LanguageModelV1Message)
      if (text) parts.push({ type: "text", text })
    }
  }

  return parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts
}

function chatMessages(options: LanguageModelV1CallOptions): ChatMessage[] {
  const messages: ChatMessage[] = []

  for (const message of options.prompt) {
    if (message.role === "system") {
      messages.push({ role: "system", content: message.content })
      continue
    }

    if (message.role === "tool") {
      // Each tool-result part becomes a separate "tool" role message (OpenAI format)
      for (const part of message.content) {
        if (part.type === "tool-result") {
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: typeof part.result === "string" ? part.result : JSON.stringify(part.result),
          })
        }
      }
      continue
    }

    if (message.role === "assistant") {
      const toolCalls: ToolCallObject[] = []
      const textParts: string[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          textParts.push(part.text)
        } else if (part.type === "tool-call") {
          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: { name: part.toolName, arguments: JSON.stringify(part.args) },
          })
        }
      }
      messages.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    // user role
    messages.push({ role: "user", content: userContent(message) })
  }

  if (options.responseFormat?.type === "json") {
    messages.unshift({
      role: "system",
      content: "Return only valid JSON. Do not wrap the JSON in markdown.",
    })
  }

  return messages
}

function requestBody(modelId: string, options: LanguageModelV1CallOptions, stream: boolean) {
  // tools/toolChoice live in options.mode in AI SDK v1
  const modeTools = options.mode.type === "regular" ? (options.mode.tools ?? []) : []
  const modeToolChoice = options.mode.type === "regular" ? options.mode.toolChoice : undefined

  const fnTools = modeTools
    .filter((t): t is LanguageModelV1FunctionTool => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))

  const toolChoice =
    fnTools.length && modeToolChoice
      ? modeToolChoice.type === "required"
        ? "required"
        : modeToolChoice.type === "none"
          ? "none"
          : "auto"
      : undefined

  return {
    model: modelId,
    messages: chatMessages(options),
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    top_p: options.topP,
    stop: options.stopSequences,
    stream,
    ...(fnTools.length ? { tools: fnTools, tool_choice: toolChoice ?? "auto" } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(options.responseFormat?.type === "json"
      ? { response_format: { type: "json_object" } }
      : {}),
  }
}

function finishReason(reason?: string | null): "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" {
  if (reason === "length") return "length"
  if (reason === "stop") return "stop"
  if (reason === "tool_calls" || reason === "function_call") return "tool-calls"
  if (reason === "content_filter") return "content-filter"
  return reason ? "other" : "stop"
}

function tokenUsage(inputTokens?: number, outputTokens?: number) {
  return {
    promptTokens: inputTokens ?? 0,
    completionTokens: outputTokens ?? 0,
  }
}

function warnings(_options: LanguageModelV1CallOptions): LanguageModelV1CallWarning[] {
  return []
}

async function chatCompletion(body: unknown, signal?: AbortSignal): Promise<Response> {
  const key = apiKey()
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`AI Credits request failed (${response.status}): ${text || response.statusText}`)
  }
  return response
}

function parseSseLine(line: string): ChatCompletionChunk | null {
  if (!line.startsWith("data:")) return null
  const data = line.slice(5).trim()
  if (!data || data === "[DONE]") return null
  return JSON.parse(data) as ChatCompletionChunk
}

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>
  usage?: { prompt_tokens: number; total_tokens: number }
}

export async function embedText(text: string): Promise<number[]> {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .slice(0, 8000)
    .trim()
  if (!cleaned) return []

  const modelId = process.env["AI_CREDITS_EMBEDDING_MODEL"] || DEFAULT_EMBEDDING_MODEL
  const key = apiKey()

  const response = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: modelId, input: cleaned }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    console.warn(`[yomi/embed] embedding request failed (${response.status}): ${text || response.statusText}`)
    return []
  }

  const json = (await response.json()) as EmbeddingResponse
  return json.data?.[0]?.embedding ?? []
}

export function createModel(modelId = DEFAULT_MODEL): LanguageModelV1 {
  return {
    specificationVersion: "v1",
    provider: "ai-credits",
    modelId,
    defaultObjectGenerationMode: "json",
    supportsImageUrls: true,
    supportsStructuredOutputs: false,

    async doGenerate(options) {
      const body = requestBody(modelId, options, false)
      const response = await chatCompletion(body, options.abortSignal)
      const json = (await response.json()) as ChatCompletionResponse
      const choice = json.choices?.[0]
      const message = choice?.message

      const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
        toolCallType: "function" as const,
        toolCallId: tc.id,
        toolName: tc.function.name,
        args: tc.function.arguments,
      }))

      return {
        text: message?.content ?? "",
        toolCalls,
        finishReason: finishReason(choice?.finish_reason),
        usage: tokenUsage(json.usage?.prompt_tokens, json.usage?.completion_tokens),
        rawCall: { rawPrompt: options.prompt, rawSettings: body },
        rawResponse: { body: json },
        response: { id: json.id, modelId: json.model ?? modelId },
        warnings: warnings(options),
      }
    },

    async doStream(options) {
      const body = requestBody(modelId, options, true)
      const response = await chatCompletion(body, options.abortSignal)

      // Accumulator for streaming tool-call deltas (index → {id, name, args so far})
      const toolCallAccum: Record<number, { id: string; name: string; args: string }> = {}

      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          const reader = response.body?.getReader()
          if (!reader) {
            controller.enqueue({ type: "error", error: new Error("AI Credits stream had no body") })
            controller.close()
            return
          }

          const decoder = new TextDecoder()
          let buffer = ""
          let stopReason: string | null | undefined
          let inputTokens = 0
          let outputTokens = 0
          controller.enqueue({ type: "response-metadata", timestamp: new Date(), modelId })

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split(/\r?\n/)
              buffer = lines.pop() ?? ""
              for (const line of lines) {
                const chunk = parseSseLine(line.trim())
                if (!chunk) continue
                const choice = chunk.choices?.[0]
                if (!choice) continue

                // Text delta
                const delta = choice.delta?.content
                if (delta) controller.enqueue({ type: "text-delta", textDelta: delta })

                // Tool-call deltas (streamed in fragments)
                for (const tc of choice.delta?.tool_calls ?? []) {
                  const idx = tc.index ?? 0
                  if (!toolCallAccum[idx]) {
                    toolCallAccum[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" }
                    controller.enqueue({
                      type: "tool-call-delta",
                      toolCallType: "function",
                      toolCallId: toolCallAccum[idx].id,
                      toolName: toolCallAccum[idx].name,
                      argsTextDelta: "",
                    })
                  }
                  if (tc.function?.name) toolCallAccum[idx].name += tc.function.name
                  if (tc.function?.arguments) {
                    toolCallAccum[idx].args += tc.function.arguments
                    controller.enqueue({
                      type: "tool-call-delta",
                      toolCallType: "function",
                      toolCallId: toolCallAccum[idx].id,
                      toolName: toolCallAccum[idx].name,
                      argsTextDelta: tc.function.arguments,
                    })
                  }
                }

                if (choice.finish_reason) stopReason = choice.finish_reason
                if (chunk.usage) {
                  inputTokens = chunk.usage.prompt_tokens ?? inputTokens
                  outputTokens = chunk.usage.completion_tokens ?? outputTokens
                }
              }
            }

            // Emit completed tool-calls
            for (const tc of Object.values(toolCallAccum)) {
              controller.enqueue({
                type: "tool-call",
                toolCallType: "function",
                toolCallId: tc.id,
                toolName: tc.name,
                args: tc.args,
              })
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
        rawCall: { rawPrompt: options.prompt, rawSettings: body },
        warnings: warnings(options),
      }
    },
  }
}
