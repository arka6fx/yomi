// Reads a newline-delimited JSON stream, handing each complete line to `onEvent`
// as it arrives. A line split across network chunks waits for its other half.
export async function readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const emit = (line: string) => {
    if (line.trim()) onEvent(JSON.parse(line) as T)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    lines.forEach(emit)
  }
  emit(buffer + decoder.decode())
}
