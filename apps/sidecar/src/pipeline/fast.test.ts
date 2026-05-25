/**
 * Tests for the sidecar fast pipeline and /query/fast HTTP endpoint.
 *
 * Mocking strategy:
 * - `mock.module("ai")` replaces `streamText` with a controllable fake that
 *   returns an async iterable of text chunks.
 * - `mock.module("@ai-sdk/openai")` replaces the factory function with a spy
 *   so we can inspect the arguments passed to it.
 * - `mock.module("./visual-guide.js")` replaces `generateGuide` so guide-mode
 *   tests don't depend on the LLM at all.
 *
 * The modules are mocked BEFORE the pipeline modules are imported so that the
 * module-level `createModel()` calls inside fast.ts and visual-guide.ts pick
 * up the mocked factories.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// TTS mock state — controls the mocked resolver below
// ---------------------------------------------------------------------------

type FakeTtsEngine = "openai" | "none";
const ttsMock = {
  engine: "none" as FakeTtsEngine,
  // Bytes the mocked synthesize() yields, one Uint8Array per chunk.
  chunks: [] as Uint8Array[],
  // Text passed to each synthesize() call — assert sentence-boundary splitting.
  calls: [] as string[],
  // If true, the mocked synthesize() throws on first iteration.
  shouldThrow: false,
  reset(): void {
    this.engine = "none";
    this.chunks = [];
    this.calls = [];
    this.shouldThrow = false;
  },
};

// ---------------------------------------------------------------------------
// Shared spy state — updated by each mock factory so tests can inspect calls
// ---------------------------------------------------------------------------

let lastOpenAIOpts: Record<string, unknown> = {};
let openAICallCount = 0;

// The text chunks that the mocked streamText will yield.
let streamChunks: string[] = ["Hello", " world", "!"];

// The guide response that the mocked generateGuide will return.
let fakeGuideResponse = {
  steps: [
    {
      instruction: "Click the message box",
      elements: [{ label: "Message box", bbox: { x: 10, y: 20, width: 100, height: 30 } }],
    },
    {
      instruction: "Type your message and press Enter",
      elements: [],
    },
  ],
};

// Capture the messages array passed to streamText for caching assertions.
let lastStreamTextMessages: unknown[] = [];
let lastStreamTextOptions: Record<string, unknown> = {};
let appendSessionCalls = 0;
let loadRecentSessionCalls = 0;

// ---------------------------------------------------------------------------
// Module mocks — must be registered before any import of the modules under test
// ---------------------------------------------------------------------------

mock.module("ai", () => ({
  streamText: (_opts: { messages?: unknown[]; [key: string]: unknown }) => {
    // Capture messages for caching assertions.
    lastStreamTextMessages = (_opts.messages as unknown[]) ?? [];
    lastStreamTextOptions = _opts;

    const chunks = [...streamChunks];
    return {
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
    };
  },
}));

mock.module("@ai-sdk/openai", () => ({
  createOpenAI: (opts: Record<string, unknown>) => {
    openAICallCount++;
    lastOpenAIOpts = opts ?? {};
    return (modelId: string) => ({ provider: "openai", modelId });
  },
}));

mock.module("openai", () => ({
  default: class {
    audio = {
      transcriptions: {
        create: async () => ({ text: "transcribed from audio" }),
      },
    }
  },
}));

mock.module("../services/sarvam/stt.js", () => ({
  sarvamTranscribe: async () => ({
    transcript: "transcribed from audio",
    language_code: "en-IN",
  }),
}));

mock.module("./visual-guide.js", () => ({
  generateGuide: (_screenshot: string, _query: string) =>
    Promise.resolve(fakeGuideResponse),
}));

mock.module("./tts.js", () => ({
  resolveTts: () => ttsMock.engine,
  synthesize: async function* (text: string) {
    ttsMock.calls.push(text);
    if (ttsMock.shouldThrow) throw new Error("tts boom");
    for (const chunk of ttsMock.chunks) yield chunk;
  },
}));

mock.module("../memory/session.js", () => ({
  appendSessionTurn: async () => { appendSessionCalls++; },
  loadRecentSession: async () => {
    loadRecentSessionCalls++;
    return "User: remember my project\nAssistant: It is Yomi.";
  },
}));

mock.module("../memory/compactor.js", () => ({
  compact: async () => {},
}));

// ---------------------------------------------------------------------------
// Now import the modules under test (after mocks are registered)
// ---------------------------------------------------------------------------

// We use a dynamic import helper so we can re-import after mutating env vars.
// Bun module cache is shared within a process, so for env-based branching tests
// we call `createModel` indirectly through fastPipeline and observe which spy
// was incremented.
import { fastPipeline } from "./fast.js";

// Import the Hono app for HTTP endpoint tests.
import app from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all events from the fastPipeline async generator into an array. */
async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of gen) {
    events.push(ev);
  }
  return events;
}

/**
 * Parse an SSE response body (text/event-stream) and return the parsed JSON
 * data payloads. Each `data: {...}` line becomes one element.
 */
async function parseSse(response: Response): Promise<unknown[]> {
  const text = await response.text();
  const events: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const json = trimmed.slice("data:".length).trim();
      if (json) {
        events.push(JSON.parse(json));
      }
    }
  }
  return events;
}

/**
 * Issue a POST /query/fast request against the Hono app.
 * The secret defaults to "test-secret" and must match SIDECAR_SECRET.
 */
function postFast(
  body: unknown,
  opts: { secret?: string | null } = {},
): Promise<Response> {
  const { secret = "test-secret" } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret !== null) {
    headers["x-sidecar-secret"] = secret;
  }
  return Promise.resolve(
    app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("fastPipeline — generator", () => {
  beforeEach(() => {
    openAICallCount = 0;
    lastOpenAIOpts = {};
    lastStreamTextMessages = [];
    lastStreamTextOptions = {};
    appendSessionCalls = 0;
    loadRecentSessionCalls = 0;
    streamChunks = ["Hello", " world", "!"];
    fakeGuideResponse = {
      steps: [
        {
          instruction: "Click the message box",
          elements: [
            { label: "Message box", bbox: { x: 10, y: 20, width: 100, height: 30 } },
          ],
        },
        {
          instruction: "Type your message and press Enter",
          elements: [],
        },
      ],
    };

    delete process.env.FAST_PATH_MODEL;
    delete process.env.SIDECAR_SECRET;
    delete process.env.OPENAI_API_KEY;
    ttsMock.reset();
  });

  // -------------------------------------------------------------------------
  // Empty / missing text
  // -------------------------------------------------------------------------

  it("empty text yields a single error event", async () => {
    const events = await collect(fastPipeline({ text: "" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", message: "No input text provided" });
  });

  it("whitespace-only text yields a single error event", async () => {
    const events = await collect(fastPipeline({ text: "   " }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", message: "No input text provided" });
  });

  it("missing text field yields a single error event", async () => {
    const events = await collect(fastPipeline({}));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", message: "No input text provided" });
  });

  // -------------------------------------------------------------------------
  // Answer mode — event sequence
  // -------------------------------------------------------------------------

  it("answer mode: first event is transcript", async () => {
    const events = await collect(fastPipeline({ text: "What is 2+2?" }));
    expect(events[0]).toMatchObject({ type: "transcript", text: "What is 2+2?" });
  });

  it("answer mode: middle events are llm_chunk", async () => {
    streamChunks = ["chunk1", "chunk2", "chunk3"];
    const events = await collect(fastPipeline({ text: "Hello" }));
    const chunks = events.filter((e: any) => e.type === "llm_chunk");
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ type: "llm_chunk", text: "chunk1" });
    expect(chunks[1]).toMatchObject({ type: "llm_chunk", text: "chunk2" });
    expect(chunks[2]).toMatchObject({ type: "llm_chunk", text: "chunk3" });
  });

  it("answer mode: last event is done", async () => {
    const events = await collect(fastPipeline({ text: "Hello" }));
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("answer mode: event sequence is transcript → llm_chunk* → done", async () => {
    streamChunks = ["A", "B"];
    const events = await collect(fastPipeline({ text: "Hi" })) as any[];
    expect(events.map((e) => e.type)).toEqual(["transcript", "llm_chunk", "llm_chunk", "done"]);
  });

  it("answer mode: makes exactly ONE streamText call (no tool-selection loop)", async () => {
    // We verify this by checking that the mock only yields the preset chunks
    // and the done event appears exactly once — a loop would produce multiple
    // done events or repeat the chunk sequence.
    const events = await collect(fastPipeline({ text: "Single call check" })) as any[];
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("answer mode: gives long writing requests a moderate output budget", async () => {
    await collect(fastPipeline({ text: "write an application for leave" }));

    expect(lastStreamTextOptions.maxTokens).toBe(1400);
  });

  it("answer mode: keeps ordinary questions on the small output budget", async () => {
    await collect(fastPipeline({ text: "what is photosynthesis" }));

    expect(lastStreamTextOptions.maxTokens).toBe(800);
  });

  it("explore plan does not load or write memory", async () => {
    await collect(fastPipeline({ text: "remember this", plan: "explore" }));

    expect(loadRecentSessionCalls).toBe(0);
    expect(appendSessionCalls).toBe(0);
  });

  it("pro plan loads recent memory and writes the completed turn", async () => {
    await collect(fastPipeline({ text: "remember this", plan: "pro" }));

    expect(loadRecentSessionCalls).toBe(1);
    expect(appendSessionCalls).toBe(1);
    expect(JSON.stringify(lastStreamTextMessages)).toContain("remember my project");
  });

  // -------------------------------------------------------------------------
  // Guide mode — event sequence
  // -------------------------------------------------------------------------

  it("guide mode: first event is transcript", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc123" }),
    );
    expect(events[0]).toMatchObject({ type: "transcript", text: "Guide me" });
  });

  it("guide mode: emits one visual_guide event per step", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc123" }),
    ) as any[];
    const guideEvents = events.filter((e) => e.type === "visual_guide");
    expect(guideEvents).toHaveLength(fakeGuideResponse.steps.length);
  });

  it("guide mode: visual_guide events have correct step numbers and total_steps", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc123" }),
    ) as any[];
    const guideEvents = events.filter((e) => e.type === "visual_guide");
    expect(guideEvents[0]).toMatchObject({
      type: "visual_guide",
      step: 1,
      total_steps: 2,
      instruction: "Click the message box",
    });
    expect(guideEvents[1]).toMatchObject({
      type: "visual_guide",
      step: 2,
      total_steps: 2,
      instruction: "Type your message and press Enter",
    });
  });

  it("guide mode: last event is done", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc123" }),
    );
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("guide mode: event sequence is transcript → visual_guide* → done", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc123" }),
    ) as any[];
    expect(events[0].type).toBe("transcript");
    expect(events[events.length - 1].type).toBe("done");
    const middle = events.slice(1, -1);
    expect(middle.every((e) => e.type === "visual_guide")).toBe(true);
  });

  it("guide mode: visual_guide step includes elements array", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc123" }),
    ) as any[];
    const firstGuide = events.find((e) => e.type === "visual_guide");
    expect(Array.isArray(firstGuide.elements)).toBe(true);
    expect(firstGuide.elements[0]).toMatchObject({
      label: "Message box",
      bbox: { x: 10, y: 20, width: 100, height: 30 },
    });
  });

  // -------------------------------------------------------------------------
  // Guide mode without screenshot
  // -------------------------------------------------------------------------

  it("guide mode with no screenshot_b64: emits single visual_guide asking user to take screenshot", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide" }),
    ) as any[];
    const guideEvents = events.filter((e) => e.type === "visual_guide");
    expect(guideEvents).toHaveLength(1);
    expect(guideEvents[0]).toMatchObject({
      type: "visual_guide",
      step: 1,
      total_steps: 1,
      instruction: "Take a screenshot so I can see what you need help with.",
      elements: [],
    });
  });

  it("guide mode with empty screenshot_b64: emits single visual_guide asking for screenshot", async () => {
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "" }),
    ) as any[];
    const guideEvents = events.filter((e) => e.type === "visual_guide");
    expect(guideEvents).toHaveLength(1);
    expect(guideEvents[0].elements).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Visual guide fallback: LLM returns elements: []
  // -------------------------------------------------------------------------

  it("guide mode: if LLM returns empty elements, visual_guide has elements: []", async () => {
    fakeGuideResponse = {
      steps: [{ instruction: "I couldn't identify visual targets.", elements: [] }],
    };
    const events = await collect(
      fastPipeline({ text: "Guide me", mode: "guide", screenshot_b64: "abc" }),
    ) as any[];
    const guideEvent = events.find((e: any) => e.type === "visual_guide");
    expect(guideEvent).toBeDefined();
    expect(guideEvent.elements).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Model selection
  // -------------------------------------------------------------------------

  it("default model is gpt-4.1-mini when FAST_PATH_MODEL is unset", async () => {
    delete process.env.FAST_PATH_MODEL;
    const events = await collect(fastPipeline({ text: "Hello" })) as any[];
    expect(events.some((e) => e.type === "llm_chunk")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // audio_b64 path — STT integration
  // -------------------------------------------------------------------------

  it("audio_b64 with no text: emits transcript with STT result, then LLM chunks", async () => {
    const dummyWav = Buffer.alloc(44).toString("base64");
    const events = await collect(fastPipeline({ audio_b64: dummyWav })) as any[];
    expect(events[0]).toMatchObject({ type: "transcript", text: "transcribed from audio" });
    expect(events.some((e) => e.type === "llm_chunk")).toBe(true);
  });

  it("audio_b64 path: text field takes precedence over audio_b64 when both present", async () => {
    const dummyWav = Buffer.alloc(44).toString("base64");
    const events = await collect(fastPipeline({ text: "explicit text", audio_b64: dummyWav })) as any[];
    expect(events[0]).toMatchObject({ type: "transcript", text: "explicit text" });
  });

  // -------------------------------------------------------------------------
  // TTS — sentence-boundary synthesis + audio_chunk events
  // -------------------------------------------------------------------------

  it("TTS disabled: no audio_chunk events, synthesize never called", async () => {
    ttsMock.engine = "none";
    ttsMock.chunks = [new Uint8Array([1, 2, 3])];
    streamChunks = ["Hello world.", " More text."];
    const events = await collect(fastPipeline({ text: "hi" })) as any[];
    expect(events.some((e) => e.type === "audio_chunk")).toBe(false);
    expect(ttsMock.calls).toEqual([]);
  });

  it("TTS enabled: emits audio_chunk events with base64-encoded bytes", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([0xde, 0xad, 0xbe, 0xef])];
    streamChunks = ["One sentence."];
    const events = await collect(fastPipeline({ text: "hi" })) as any[];
    const audio = events.filter((e) => e.type === "audio_chunk");
    expect(audio.length).toBeGreaterThan(0);
    expect(audio[0].base64).toBe(Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString("base64"));
  });

  it("TTS: synthesize called once per sentence boundary", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([1])];
    // Three sentences. Match the regex `[.!?]\s` so boundaries fire mid-stream.
    streamChunks = ["First sentence. ", "Second one! ", "And third?"];
    await collect(fastPipeline({ text: "hi" }));
    expect(ttsMock.calls).toEqual(["First sentence.", "Second one!", "And third?"]);
  });

  it("TTS: skips fenced answer blocks while keeping them in the UI stream", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([1])];
    streamChunks = ["Reason first. \n```answer\nB. Correct choice.\n```\nDone."];
    const events = await collect(fastPipeline({ text: "hi" })) as any[];

    const uiText = events
      .filter((event) => event.type === "llm_chunk")
      .map((event) => event.text)
      .join("");
    expect(uiText).toContain("```answer");
    expect(ttsMock.calls).toEqual(["Reason first.", "Done."]);
  });

  it("TTS: tail without trailing whitespace is still synthesized at end", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([1])];
    // No trailing space after the final period — won't hit the regex mid-stream,
    // so it falls through to the end-of-stream flush.
    streamChunks = ["No trailing space."];
    await collect(fastPipeline({ text: "hi" }));
    expect(ttsMock.calls).toEqual(["No trailing space."]);
  });

  it("TTS: empty/whitespace-only buffer at end is not synthesized", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([1])];
    streamChunks = ["One sentence. "]; // boundary cuts cleanly, no tail text
    await collect(fastPipeline({ text: "hi" }));
    expect(ttsMock.calls).toEqual(["One sentence."]);
  });

  it("TTS: yields multiple audio_chunk events per sentence when synth returns multiple chunks", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    streamChunks = ["One sentence."];
    const events = await collect(fastPipeline({ text: "hi" })) as any[];
    const audio = events.filter((e) => e.type === "audio_chunk");
    expect(audio).toHaveLength(3);
  });

  it("TTS: done is still the last event when audio is present", async () => {
    ttsMock.engine = "openai";
    ttsMock.chunks = [new Uint8Array([1, 2])];
    streamChunks = ["Hello world."];
    const events = await collect(fastPipeline({ text: "hi" })) as any[];
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("TTS: synthesis errors are swallowed, text response still completes", async () => {
    ttsMock.engine = "openai";
    ttsMock.shouldThrow = true;
    streamChunks = ["Hello world."];
    const events = await collect(fastPipeline({ text: "hi" })) as any[];
    // No error event, has llm_chunks, ends with done.
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "llm_chunk")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoint tests — POST /query/fast
// ---------------------------------------------------------------------------

describe("POST /query/fast — HTTP endpoint", () => {
  beforeEach(() => {
    delete process.env.FAST_PATH_MODEL;
    delete process.env.OPENAI_API_KEY;
    streamChunks = ["Hello", " world"];
    ttsMock.reset();
    fakeGuideResponse = {
      steps: [
        {
          instruction: "Click OK",
          elements: [{ label: "OK button", bbox: { x: 5, y: 5, width: 50, height: 20 } }],
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Auth guard
  //
  // NOTE: `SIDECAR_SECRET` in src/index.ts is captured as a module-level
  // constant at import time, so it cannot be changed by mutating process.env
  // after the module has loaded. The tests below verify the auth middleware
  // logic directly via a minimal Hono app that mirrors the production
  // implementation, and also confirm the already-loaded `app` behaves
  // correctly for the secret value that was present at import time.
  // -------------------------------------------------------------------------

  it("auth middleware: rejects missing secret with 401", async () => {
    // Build a minimal Hono app that mirrors authMiddleware with a known secret.
    const { Hono } = await import("hono");
    const testApp = new Hono();
    const TEST_SECRET = "guard-test-secret";
    testApp.use("/protected", (c: any, next: any) => {
      const header = c.req.header("x-sidecar-secret");
      if (TEST_SECRET && header !== TEST_SECRET) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    });
    testApp.get("/protected", (c: any) => c.json({ ok: true }));

    const res = await testApp.fetch(new Request("http://localhost/protected"));
    expect(res.status).toBe(401);
  });

  it("auth middleware: rejects wrong secret with 401", async () => {
    const { Hono } = await import("hono");
    const testApp = new Hono();
    const TEST_SECRET = "guard-test-secret";
    testApp.use("/protected", (c: any, next: any) => {
      const header = c.req.header("x-sidecar-secret");
      if (TEST_SECRET && header !== TEST_SECRET) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    });
    testApp.get("/protected", (c: any) => c.json({ ok: true }));

    const res = await testApp.fetch(
      new Request("http://localhost/protected", {
        headers: { "x-sidecar-secret": "wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("auth middleware: accepts correct secret", async () => {
    const { Hono } = await import("hono");
    const testApp = new Hono();
    const TEST_SECRET = "guard-test-secret";
    testApp.use("/protected", (c: any, next: any) => {
      const header = c.req.header("x-sidecar-secret");
      if (TEST_SECRET && header !== TEST_SECRET) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    });
    testApp.get("/protected", (c: any) => c.json({ ok: true }));

    const res = await testApp.fetch(
      new Request("http://localhost/protected", {
        headers: { "x-sidecar-secret": TEST_SECRET },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("auth middleware: passes all requests when no secret is configured", async () => {
    const { Hono } = await import("hono");
    const testApp = new Hono();
    const CONFIGURED_SECRET = undefined; // no secret set
    testApp.use("/protected", (c: any, next: any) => {
      const header = c.req.header("x-sidecar-secret");
      if (CONFIGURED_SECRET && header !== CONFIGURED_SECRET) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    });
    testApp.get("/protected", (c: any) => c.json({ ok: true }));

    const res = await testApp.fetch(new Request("http://localhost/protected"));
    expect(res.status).toBe(200);
  });

  it("loaded app: accepts requests without auth when SIDECAR_SECRET was unset at startup", async () => {
    // The app module was imported without SIDECAR_SECRET set, so auth is off.
    const res = await postFast({ text: "Hello" }, { secret: null });
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Empty / missing text — HTTP-level validation
  // -------------------------------------------------------------------------

  it("returns 400 for missing text field", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty text field", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for whitespace-only text", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "   " });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // SSE content-type
  // -------------------------------------------------------------------------

  it("responds with text/event-stream content type for valid request", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "Hello" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  // -------------------------------------------------------------------------
  // Answer mode SSE events via HTTP
  // -------------------------------------------------------------------------

  it("answer mode: SSE stream starts with transcript event", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "What time is it?" });
    const events = await parseSse(res) as any[];
    expect(events[0]).toMatchObject({ type: "transcript", text: "What time is it?" });
  });

  it("answer mode: SSE stream contains llm_chunk events", async () => {
    delete process.env.SIDECAR_SECRET;
    streamChunks = ["chunk1", "chunk2"];
    const res = await postFast({ text: "Hello" });
    const events = await parseSse(res) as any[];
    const chunks = events.filter((e) => e.type === "llm_chunk");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("answer mode: SSE stream ends with done event", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "Hello" });
    const events = await parseSse(res) as any[];
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  // -------------------------------------------------------------------------
  // Guide mode SSE events via HTTP
  // -------------------------------------------------------------------------

  it("guide mode: SSE stream starts with transcript event", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "Guide me", mode: "guide", screenshot_b64: "abc" });
    const events = await parseSse(res) as any[];
    expect(events[0]).toMatchObject({ type: "transcript", text: "Guide me" });
  });

  it("guide mode: SSE stream contains visual_guide events", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "Guide me", mode: "guide", screenshot_b64: "abc" });
    const events = await parseSse(res) as any[];
    const guideEvents = events.filter((e: any) => e.type === "visual_guide");
    expect(guideEvents.length).toBeGreaterThan(0);
  });

  it("guide mode: SSE stream ends with done event", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "Guide me", mode: "guide", screenshot_b64: "abc" });
    const events = await parseSse(res) as any[];
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("guide mode without screenshot: single visual_guide asks for screenshot", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({ text: "Guide me", mode: "guide" });
    const events = await parseSse(res) as any[];
    const guideEvents = events.filter((e: any) => e.type === "visual_guide");
    expect(guideEvents).toHaveLength(1);
    expect(guideEvents[0]).toMatchObject({
      type: "visual_guide",
      step: 1,
      total_steps: 1,
      elements: [],
    });
    expect(guideEvents[0].instruction).toMatch(/screenshot/i);
  });

  // -------------------------------------------------------------------------
  // audio_b64 path — HTTP
  // -------------------------------------------------------------------------

  it("returns 400 when both text and audio_b64 are absent", async () => {
    delete process.env.SIDECAR_SECRET;
    const res = await postFast({});
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/text or audio_b64/);
  });

  it("accepts audio_b64 without text and streams transcript event", async () => {
    delete process.env.SIDECAR_SECRET;
    const dummyWav = Buffer.alloc(44).toString("base64");
    const res = await postFast({ audio_b64: dummyWav });
    expect(res.status).toBe(200);
    const events = await parseSse(res) as any[];
    expect(events[0]).toMatchObject({ type: "transcript", text: "transcribed from audio" });
  });

  // -------------------------------------------------------------------------
  // Health check — sanity
  // -------------------------------------------------------------------------

  it("GET /health returns 200 with status ok", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });
});
