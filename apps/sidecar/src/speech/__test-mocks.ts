import { mock } from "bun:test"

// Shared whisper / fs mocks. Bun's mock.module() is process-global; centralising
// the registration here avoids cross-file mock collisions when multiple test
// files exercise the STT code paths. Each test resets and configures state via
// the exported `whisperMock` object before invocation.

export const whisperMock = {
  result: "  default whisper result  ",
  shouldThrow: false,
  lastFilePath: "",
  lastOpts: null as unknown,
  writeFilePath: "",
  unlinkCalled: false,
  reset(): void {
    this.result = "  default whisper result  "
    this.shouldThrow = false
    this.lastFilePath = ""
    this.lastOpts = null
    this.writeFilePath = ""
    this.unlinkCalled = false
  },
}

mock.module("nodejs-whisper", () => ({
  nodewhisper: async (filePath: string, opts: unknown) => {
    whisperMock.lastFilePath = filePath
    whisperMock.lastOpts = opts
    if (whisperMock.shouldThrow) throw new Error("whisper error")
    return whisperMock.result
  },
}))

mock.module("fs/promises", () => ({
  writeFile: async (path: string) => {
    whisperMock.writeFilePath = path
  },
  unlink: async () => {
    whisperMock.unlinkCalled = true
  },
}))
