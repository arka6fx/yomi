# Geolocation Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user share a Telegram location pin with Yomi and have the agent act on it via a new Google Maps Composio connector (nearby search, text search).

**Architecture:** Telegram's `message.location` field is parsed into a new `location` field on `GatewayMessage`, surfaced to the agent as plain coordinate text (no automatic reverse-geocode call). A new Composio-backed connector (`google-maps`) exposes exactly 2 live-verified, read-only tools — `GOOGLE_MAPS_NEARBY_SEARCH` and `GOOGLE_MAPS_TEXT_SEARCH` — wired into the existing connector registry the same way every other Composio connector is.

**Tech Stack:** Hono/Bun backend, TypeScript, Zod (tool parameter schemas), Composio REST API (`backend.composio.dev`), Bun test runner.

## Global Constraints

- No new dependencies (spec: "Scope (v1)").
- Exactly 2 Google Maps tools: `GOOGLE_MAPS_NEARBY_SEARCH`, `GOOGLE_MAPS_TEXT_SEARCH`. Do NOT add `GOOGLE_MAPS_GEOCODING_API`, `GOOGLE_MAPS_GET_DIRECTION`, `GOOGLE_MAPS_GET_ROUTE`, `GOOGLE_MAPS_DISTANCE_MATRIX_API`, or `GOOGLE_MAPS_MAPS_EMBED_API` — the first two were live-tested during design and require a classic Maps API key even under OAuth2; the rest are out of scope (spec: "Part 2: Google Maps connector").
- Telegram: static pin location only. Do NOT add `edited_message`/live-location handling (spec: "Scope (v1)").
- No automatic reverse-geocoding on location receipt — plain coordinate text only, the agent decides whether to call a Maps tool (spec: "Part 1: Telegram location ingestion").
- Both Maps tools classify as `"read"` in `COMPOSIO_RISK_MAP` — no approval gating (spec: "Part 2").
- Composio toolkit slug is exactly `google_maps` (underscore, matches Composio's live catalog) — the def's `auth.toolkit` and the classification map key MUST match this exactly, or every action falls through to default-deny (write), same failure mode already documented for `google_classroom` in `classification.ts`.
- `makeComposioMapsDef`: `id: "google-maps"`, `category: "productivity"`, `readOnlyByDefault: true`, `authConfigIdEnv: "COMPOSIO_MAPS_AUTH_CONFIG_ID"` (spec: "Part 2").
- Auth config already created in Composio: `ac_pDcfNJ-uh2vw` (OAuth2, Composio-managed).
- `bun run typecheck` and `bun run lint` must pass clean before any task is considered done (project convention, `AGENTS.md`).
- Commit messages: Conventional Commits, lowercase, no full stop, max 72 chars (`AGENTS.md`).
- Follow the existing Composio connector pattern exactly — `packages/agent-core/src/connectors/composio/google-docs.ts` (and its test file) is the closest template: no native fallback, `unconfiguredComposioExecutor` placeholder in `all-defs.ts`.

---

### Task 1: Telegram location parsing

**Files:**
- Modify: `packages/shared/src/index.ts:238-244` (add `location` to `GatewayMessage`)
- Modify: `apps/backend/src/gateway/platforms/telegram.ts` (add `location` to `TelegramUpdate`, parse it in `processUpdate`, fix the drop guard)
- Create: `apps/backend/src/gateway/platforms/telegram.test.ts` (no test file exists for this adapter today)

**Interfaces:**
- Produces: `GatewayMessage.location?: { latitude: number; longitude: number }` — consumed by Task 2's `gateway-runner.ts` block.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/gateway/platforms/telegram.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import type { GatewayMessage } from "@yomi/shared"
import { TelegramAdapter, type TelegramUpdate } from "./telegram.js"

function makeAdapter() {
  const adapter = new TelegramAdapter("dummy-token")
  const received: GatewayMessage[] = []
  adapter.setMessageHandler((msg) => {
    received.push(msg)
  })
  return { adapter, received }
}

describe("TelegramAdapter.processUpdate — location", () => {
  it("surfaces a location-only update as a GatewayMessage with location set", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
        location: { latitude: 12.9716, longitude: 77.5946 },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(1)
    expect(received[0]?.location).toEqual({ latitude: 12.9716, longitude: 77.5946 })
    expect(received[0]?.text).toBe("")
  })

  it("still drops an update with no text, no attachments, and no location", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 101,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `cd apps/backend && bun test src/gateway/platforms/telegram.test.ts`
Expected: the first test FAILS — `received` has length 0, not 1, because `TelegramUpdate.message` has no `location` field yet and `processUpdate`'s guard drops the update entirely (`msg.location` doesn't exist to check). The second test passes already (no behavior change needed for it) — that's expected, it's a regression guard, not new behavior.

- [ ] **Step 3: Add `location` to `TelegramUpdate`**

In `apps/backend/src/gateway/platforms/telegram.ts`, find:

```ts
    video?: {
      file_id: string
      mime_type?: string
      duration: number
      file_size?: number
      file_name?: string
    }
  }
}
```

Replace with:

```ts
    video?: {
      file_id: string
      mime_type?: string
      duration: number
      file_size?: number
      file_name?: string
    }
    location?: { latitude: number; longitude: number }
  }
}
```

- [ ] **Step 4: Add `location` to `GatewayMessage`**

In `packages/shared/src/index.ts`, find:

```ts
  /** Video duration in seconds when supplied by the platform */
  videoDurationSeconds?: number
}
```

Replace with:

```ts
  /** Video duration in seconds when supplied by the platform */
  videoDurationSeconds?: number
  /** Coordinates when the user shared a location pin */
  location?: { latitude: number; longitude: number }
}
```

- [ ] **Step 5: Parse `msg.location` in `processUpdate` and fix the drop guard**

In `apps/backend/src/gateway/platforms/telegram.ts`, find:

```ts
    if (!hasText && !voiceFile && !imageFile && !documentFile && !msg.video) return
```

Replace with:

```ts
    if (!hasText && !voiceFile && !imageFile && !documentFile && !msg.video && !msg.location) return
```

Then find the `GatewayMessage` construction:

```ts
    const gatewayMsg: GatewayMessage = {
      platform: "telegram",
      chatId: String(msg.chat.id),
      userId: String(msg.from?.id ?? "unknown"),
      text,
      messageId: String(msg.message_id),
      timestamp: new Date().toISOString(),
      audioUrl,
      audioMimeType,
      audioDurationSeconds,
      imageUrl,
      imageMimeType,
      documentUrl,
      documentMimeType,
      documentFileName,
      documentSize,
      videoUrl,
      videoMimeType,
      videoDurationSeconds,
    }
```

Replace with:

```ts
    const gatewayMsg: GatewayMessage = {
      platform: "telegram",
      chatId: String(msg.chat.id),
      userId: String(msg.from?.id ?? "unknown"),
      text,
      messageId: String(msg.message_id),
      timestamp: new Date().toISOString(),
      audioUrl,
      audioMimeType,
      audioDurationSeconds,
      imageUrl,
      imageMimeType,
      documentUrl,
      documentMimeType,
      documentFileName,
      documentSize,
      videoUrl,
      videoMimeType,
      videoDurationSeconds,
      location: msg.location,
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/backend && bun test src/gateway/platforms/telegram.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck` (from repo root — `packages/shared` and `apps/backend` both need to pick up the new field)
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts apps/backend/src/gateway/platforms/telegram.ts apps/backend/src/gateway/platforms/telegram.test.ts
git commit -m "feat: parse telegram location messages into gateway messages"
```

---

### Task 2: Surface location as agent context text

**Files:**
- Modify: `apps/backend/src/gateway/gateway-runner.ts` (new location-context block)
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts` (add one test)

**Interfaces:**
- Consumes: `GatewayMessage.location` (Task 1).
- Produces: no new exports — mutates `msg.text` in place before the agent turn, same pattern as the existing document/video blocks in the same file.

- [ ] **Step 1: Write the failing test**

In `apps/backend/src/gateway/gateway-runner.test.ts`, find the closing of the `"runs backend agent for normal Telegram messages"` test (ends with its `})`) and add this test immediately after it, inside the same `describe("GatewayRunner production routing", ...)` block:

```ts
  it("surfaces a shared location as agent context text", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "",
      location: { latitude: 12.9716, longitude: 77.5946 },
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls[0]?.text).toBe("📍 _Location:_ 12.9716, 77.5946")
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && bun test src/gateway/gateway-runner.test.ts -t "surfaces a shared location"`
Expected: FAIL — `agentCalls[0]?.text` is `""`, not the expected location note, because `gateway-runner.ts` doesn't read `msg.location` yet.

- [ ] **Step 3: Add the location-context block**

In `apps/backend/src/gateway/gateway-runner.ts`, find the video context block:

```ts
      // ── Video context ──────────────────────────────────────────────────────
      if (msg.videoUrl) {
        const dur = msg.videoDurationSeconds
          ? ` (${Math.floor(msg.videoDurationSeconds / 60)}:${(msg.videoDurationSeconds % 60).toString().padStart(2, "0")})`
          : ""
        console.warn(`[gateway] video received${dur}`)
        const note = `🎬 _Video received_`
        msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
      }
```

Replace with:

```ts
      // ── Video context ──────────────────────────────────────────────────────
      if (msg.videoUrl) {
        const dur = msg.videoDurationSeconds
          ? ` (${Math.floor(msg.videoDurationSeconds / 60)}:${(msg.videoDurationSeconds % 60).toString().padStart(2, "0")})`
          : ""
        console.warn(`[gateway] video received${dur}`)
        const note = `🎬 _Video received_`
        msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
      }

      // ── Location context ──────────────────────────────────────────────────
      // No automatic reverse-geocoding here — raw coordinates are already legible
      // to the model, and an eager Maps call on every pin-share would add latency
      // the user didn't ask for. The agent calls the Maps connector's tools
      // itself when it decides the location is relevant to what the user wants.
      if (msg.location) {
        const { latitude, longitude } = msg.location
        console.warn(`[gateway] location received: ${latitude}, ${longitude}`)
        const note = `📍 _Location:_ ${latitude}, ${longitude}`
        msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && bun test src/gateway/gateway-runner.test.ts -t "surfaces a shared location"`
Expected: PASS.

- [ ] **Step 5: Run the full gateway-runner suite to confirm no regressions**

Run: `cd apps/backend && bun test src/gateway/gateway-runner.test.ts`
Expected: all tests PASS (the new test plus every pre-existing one).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/gateway/gateway-runner.ts apps/backend/src/gateway/gateway-runner.test.ts
git commit -m "feat: surface shared location as agent context text"
```

---

### Task 3: Google Maps Composio connector + risk classification

**Files:**
- Create: `packages/agent-core/src/connectors/composio/google-maps.ts`
- Create: `packages/agent-core/src/connectors/composio/google-maps.test.ts`
- Modify: `packages/agent-core/src/connectors/composio/classification.ts`
- Modify: `packages/agent-core/src/connectors/composio/classification.test.ts`

**Interfaces:**
- Consumes: `ConnectorDef` from `../connector-def.js`, `createComposioTools`/`ComposioExecutor`/`ComposioToolSpec` from `./adapter.js` (all pre-existing).
- Produces: `export const MAPS_TOOLKIT = "google_maps"`, `export const mapsComposioSpecs: ComposioToolSpec[]`, `export function makeComposioMapsDef(executor: ComposioExecutor): ConnectorDef` — consumed by Task 4.

- [ ] **Step 1: Write the failing connector tests**

Create `packages/agent-core/src/connectors/composio/google-maps.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioMapsDef, mapsComposioSpecs, MAPS_TOOLKIT } from "./google-maps.js"
import { createComposioTools } from "./adapter.js"
import type { ComposioExecutor } from "./adapter.js"

function fakeExecutor(result: unknown = { ok: true }): ComposioExecutor & {
  calls: { userId: string; slug: string; arguments: unknown }[]
} {
  const calls: { userId: string; slug: string; arguments: unknown }[] = []
  return {
    calls,
    execute: async (input) => {
      calls.push(input)
      return result
    },
  }
}

function buildCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    userId: "user_1",
    getAccessToken: async () => "unused-for-composio",
    ...overrides,
  }
}

describe("Google Maps via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id, category, and read-only default", () => {
    const def = makeComposioMapsDef(fakeExecutor())
    expect(def.id).toBe("google-maps")
    expect(def.name).toBe("Google Maps")
    expect(def.category).toBe("productivity")
    expect(def.readOnlyByDefault).toBe(true)
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: MAPS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MAPS_AUTH_CONFIG_ID",
    })
  })

  it("exposes exactly the 2 live-verified tools, keyed by Composio slug", () => {
    const def = makeComposioMapsDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLE_MAPS_NEARBY_SEARCH"]).toBeDefined()
    expect(tools["GOOGLE_MAPS_TEXT_SEARCH"]).toBeDefined()
    expect(Object.keys(tools)).toHaveLength(2)
  })
})

describe("Google Maps via Composio — read pass-through", () => {
  it("executes nearby search directly and returns the result, with no approval gating", async () => {
    const executor = fakeExecutor({ places: [{ displayName: { text: "Blue Tokai Coffee" } }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-maps",
      toolkit: MAPS_TOOLKIT,
      specs: mapsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLE_MAPS_NEARBY_SEARCH"]!.execute({
      latitude: 12.9716,
      longitude: 77.5946,
      radius: 500,
    })

    expect(result).toEqual({ places: [{ displayName: { text: "Blue Tokai Coffee" } }] })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "GOOGLE_MAPS_NEARBY_SEARCH",
        arguments: { latitude: 12.9716, longitude: 77.5946, radius: 500 },
      },
    ])
    expect(create).not.toHaveBeenCalled()
  })

  it("executes text search directly and returns the result, with no approval gating", async () => {
    const executor = fakeExecutor({ places: [{ displayName: { text: "Third Wave Coffee" } }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-maps",
      toolkit: MAPS_TOOLKIT,
      specs: mapsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLE_MAPS_TEXT_SEARCH"]!.execute({
      textQuery: "coffee shop near Koramangala",
    })

    expect(result).toEqual({ places: [{ displayName: { text: "Third Wave Coffee" } }] })
    expect(create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-core && bun test src/connectors/composio/google-maps.test.ts`
Expected: FAIL — `google-maps.js` module not found.

- [ ] **Step 3: Implement `google-maps.ts`**

Create `packages/agent-core/src/connectors/composio/google-maps.ts`:

```ts
import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const MAPS_TOOLKIT = "google_maps"

// Every slug and param below was checked against Composio's live catalog (GET
// /api/v3/tools?toolkit_slug=google_maps), then each candidate tool was executed
// live against a real OAuth-connected test account before being included here.
// GOOGLE_MAPS_GEOCODING_API and GOOGLE_MAPS_GET_DIRECTION both exist in the
// catalog but were EXCLUDED after live testing: both require a classic Google
// Maps Platform API key even with an active OAuth2 connection (Google never
// added OAuth support for the legacy Geocoding/Directions APIs) —
// GEOCODING_API failed with "missing: key", GET_DIRECTION failed with "You must
// use an API key to authenticate each request to Google Maps Platform APIs".
// The two tools below both succeeded live via OAuth2 alone, no key needed.
export const mapsComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLE_MAPS_NEARBY_SEARCH",
    description:
      "Search for places (restaurants, parks, pharmacies, etc.) within a circular area around a coordinate. Takes lat/lon directly — the natural fit right after a user shares a location pin. Read-only.",
    parameters: z
      .object({
        latitude: z.number().min(-90).max(90).describe("Latitude of the search center, in decimal degrees"),
        longitude: z.number().min(-180).max(180).describe("Longitude of the search center, in decimal degrees"),
        radius: z.number().min(0).max(50000).describe("Radius of the search area in meters (max 50000)"),
        includedTypes: z
          .array(z.string())
          .optional()
          .describe("Place types to include, e.g. ['restaurant'] or ['atm', 'bank'] — results match at least one"),
        excludedTypes: z
          .array(z.string())
          .optional()
          .describe("Place types to exclude, e.g. ['cafe'] — results matching any of these are omitted"),
        maxResultCount: z.number().int().min(1).max(20).optional().describe("Max results to return (default 10)"),
        fieldMask: z
          .string()
          .optional()
          .describe(
            "Comma-separated place fields to return, e.g. 'places.displayName,places.formattedAddress' (default: 'places.displayName')",
          ),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_MAPS_TEXT_SEARCH",
    description:
      "Search for places using a free-text query, e.g. 'coffee shops near Koramangala' or 'Eiffel Tower'. Matches against place name, address, and category. Read-only.",
    parameters: z
      .object({
        textQuery: z.string().describe("Free-text search query, e.g. 'restaurants in London' or 'coffee shops near me'"),
        maxResultCount: z.number().int().min(1).max(20).optional().describe("Max results to return (default 10)"),
        fieldMask: z
          .string()
          .optional()
          .describe(
            "Comma-separated place fields to return, e.g. 'places.displayName,places.formattedAddress' (default: 'places.displayName,places.formattedAddress,places.priceLevel')",
          ),
      })
      .passthrough(),
  },
]

export function makeComposioMapsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-maps",
    name: "Google Maps",
    category: "productivity",
    icon: "google-maps",
    description: "Search for places and businesses near a location (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: MAPS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MAPS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_MAPS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-maps to route Maps through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_MAPS_AUTH_CONFIG_ID", label: "Composio Maps auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/google_maps",
    },
    tools: createComposioTools({
      provider: "google-maps",
      toolkit: MAPS_TOOLKIT,
      specs: mapsComposioSpecs,
      executor,
    }),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-core && bun test src/connectors/composio/google-maps.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing classification tests**

In `packages/agent-core/src/connectors/composio/classification.test.ts`, find the Meet block:

```ts
    it("classifies Meet read actions as read", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_GET_MEET")).toBe("read")
    })

    it("classifies Meet write actions as write", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_CREATE_MEET")).toBe("write")
    })
  })
})
```

Replace with:

```ts
    it("classifies Meet read actions as read", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_GET_MEET")).toBe("read")
    })

    it("classifies Meet write actions as write", () => {
      expect(classifyAction("googlemeet", "GOOGLEMEET_CREATE_MEET")).toBe("write")
    })

    it("classifies Maps read actions as read", () => {
      expect(classifyAction("google_maps", "GOOGLE_MAPS_NEARBY_SEARCH")).toBe("read")
      expect(classifyAction("google_maps", "GOOGLE_MAPS_TEXT_SEARCH")).toBe("read")
    })

    it("defaults an unclassified Maps action to write (covers the excluded GEOCODING_API/GET_DIRECTION tools)", () => {
      expect(classifyAction("google_maps", "GOOGLE_MAPS_GEOCODING_API")).toBe("write")
    })
  })
})
```

Then find the "keeps the map as plain data" test:

```ts
  it("keeps the map as plain data keyed by lowercase toolkit", () => {
    expect(COMPOSIO_RISK_MAP["linear"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["github"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["gmail"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlecalendar"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googledrive"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googledocs"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlesheets"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googleslides"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["google_classroom"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googletasks"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlemeet"]).toBeDefined()
```

Replace with:

```ts
  it("keeps the map as plain data keyed by lowercase toolkit", () => {
    expect(COMPOSIO_RISK_MAP["linear"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["github"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["gmail"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlecalendar"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googledrive"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googledocs"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlesheets"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googleslides"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["google_classroom"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googletasks"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["googlemeet"]).toBeDefined()
    expect(COMPOSIO_RISK_MAP["google_maps"]).toBeDefined()
```

- [ ] **Step 6: Run the classification tests to verify the new ones fail**

Run: `cd packages/agent-core && bun test src/connectors/composio/classification.test.ts -t "Maps"`
Expected: FAIL — `google_maps` isn't in `COMPOSIO_RISK_MAP` yet, so `classifyAction("google_maps", "GOOGLE_MAPS_NEARBY_SEARCH")` falls through default-deny and returns `"write"`, not `"read"`.

- [ ] **Step 7: Add the `google_maps` entry to `COMPOSIO_RISK_MAP`**

In `packages/agent-core/src/connectors/composio/classification.ts`, find the end of the `slack: { ... }` block (the last entry before the closing `}` of `COMPOSIO_RISK_MAP`):

```ts
    // Irreversible — gated, flagged as unrecoverable.
    SLACK_DELETES_A_MESSAGE_FROM_A_CHAT: "irreversible",
    SLACK_DELETE_FILE: "irreversible",
    SLACK_DELETE_FILE_COMMENT: "irreversible",
    SLACK_DELETE_CHANNEL: "irreversible",
    SLACK_DELETE_REMINDER: "irreversible",
    SLACK_DELETE_CANVAS: "irreversible",
    SLACK_DELETE_MULTIPLE_SLACK_LIST_ITEMS: "irreversible",
    SLACK_DELETE_SLACK_LIST_ITEM: "irreversible",
    SLACK_ARCHIVE_CONVERSATION: "irreversible",
    SLACK_CONVERT_CHANNEL_TO_PRIVATE: "irreversible",
  },
}
```

Replace with:

```ts
    // Irreversible — gated, flagged as unrecoverable.
    SLACK_DELETES_A_MESSAGE_FROM_A_CHAT: "irreversible",
    SLACK_DELETE_FILE: "irreversible",
    SLACK_DELETE_FILE_COMMENT: "irreversible",
    SLACK_DELETE_CHANNEL: "irreversible",
    SLACK_DELETE_REMINDER: "irreversible",
    SLACK_DELETE_CANVAS: "irreversible",
    SLACK_DELETE_MULTIPLE_SLACK_LIST_ITEMS: "irreversible",
    SLACK_DELETE_SLACK_LIST_ITEM: "irreversible",
    SLACK_ARCHIVE_CONVERSATION: "irreversible",
    SLACK_CONVERT_CHANNEL_TO_PRIVATE: "irreversible",
  },
  // Composio's toolkit slug is "google_maps" (underscore) — must match exactly,
  // same footgun as google_classroom above: a mismatch falls through to
  // default-deny (every action classified "write").
  google_maps: {
    // Reads — pass straight through. Only 2 tools are wired up for this toolkit
    // (see google-maps.ts for why GEOCODING_API/GET_DIRECTION are excluded) —
    // both are read-only searches, so this toolkit has no write actions at all.
    GOOGLE_MAPS_NEARBY_SEARCH: "read",
    GOOGLE_MAPS_TEXT_SEARCH: "read",
  },
}
```

- [ ] **Step 8: Run the classification tests to verify they pass**

Run: `cd packages/agent-core && bun test src/connectors/composio/classification.test.ts`
Expected: PASS, all tests (existing + new).

- [ ] **Step 9: Run the full agent-core suite and typecheck**

Run: `cd packages/agent-core && bun test && bun run typecheck`
Expected: all tests PASS, no typecheck errors.

- [ ] **Step 10: Commit**

```bash
git add packages/agent-core/src/connectors/composio/google-maps.ts packages/agent-core/src/connectors/composio/google-maps.test.ts packages/agent-core/src/connectors/composio/classification.ts packages/agent-core/src/connectors/composio/classification.test.ts
git commit -m "feat: add google maps composio connector (nearby+text search)"
```

---

### Task 4: Register the connector in agent-core's registry

**Files:**
- Modify: `packages/agent-core/src/connectors/all-defs.ts`
- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**
- Consumes: `makeComposioMapsDef` (Task 3).
- Produces: `google-maps` becomes a member of `ALL_CONNECTOR_DEFS`, and `makeComposioMapsDef`/`mapsComposioSpecs`/`MAPS_TOOLKIT` become part of `@yomi/agent-core`'s public exports — both consumed by Task 5.

No test file changes: `all-defs.ts` has no dedicated test, and `registry-selection.test.ts` tests the native↔composio switch generically using Linear as its example (not enumerating every connector id) — nothing there needs updating for a new connector.

- [ ] **Step 1: Add the connector to `ALL_CONNECTOR_DEFS`**

In `packages/agent-core/src/connectors/all-defs.ts`, find:

```ts
import { swiggyDef } from "./swiggy-def.js"
import { makeComposioDocsDef } from "./composio/google-docs.js"
import { makeComposioSheetsDef } from "./composio/google-sheets.js"
import { makeComposioSlidesDef } from "./composio/google-slides.js"
import type { ComposioExecutor } from "./composio/adapter.js"
```

Replace with:

```ts
import { swiggyDef } from "./swiggy-def.js"
import { makeComposioDocsDef } from "./composio/google-docs.js"
import { makeComposioSheetsDef } from "./composio/google-sheets.js"
import { makeComposioSlidesDef } from "./composio/google-slides.js"
import { makeComposioMapsDef } from "./composio/google-maps.js"
import type { ComposioExecutor } from "./composio/adapter.js"
```

Then find:

```ts
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  googleGmailDef,
  googleCalendarDef,
  googleDriveDef,
  makeComposioDocsDef(unconfiguredComposioExecutor),
  makeComposioSheetsDef(unconfiguredComposioExecutor),
  makeComposioSlidesDef(unconfiguredComposioExecutor),
  googleClassroomDef,
  googleTasksDef,
  googleMeetDef,
  githubDef,
  notionDef,
  slackDef,
  linearDef,
  swiggyDef,
]
```

Replace with:

```ts
export const ALL_CONNECTOR_DEFS: ConnectorDef[] = [
  googleGmailDef,
  googleCalendarDef,
  googleDriveDef,
  makeComposioDocsDef(unconfiguredComposioExecutor),
  makeComposioSheetsDef(unconfiguredComposioExecutor),
  makeComposioSlidesDef(unconfiguredComposioExecutor),
  googleClassroomDef,
  googleTasksDef,
  googleMeetDef,
  makeComposioMapsDef(unconfiguredComposioExecutor),
  githubDef,
  notionDef,
  slackDef,
  linearDef,
  swiggyDef,
]
```

- [ ] **Step 2: Export the connector from `@yomi/agent-core`**

In `packages/agent-core/src/index.ts`, find:

```ts
export {
  makeComposioMeetDef,
  meetComposioSpecs,
  MEET_TOOLKIT,
} from "./connectors/composio/google-meet.js"
```

Replace with:

```ts
export {
  makeComposioMeetDef,
  meetComposioSpecs,
  MEET_TOOLKIT,
} from "./connectors/composio/google-meet.js"
export {
  makeComposioMapsDef,
  mapsComposioSpecs,
  MAPS_TOOLKIT,
} from "./connectors/composio/google-maps.js"
```

(If Meet's export block doesn't appear verbatim as above — e.g. its surrounding exports differ slightly from this snapshot — add the new `google-maps` export block immediately after whichever block currently exports `makeComposioMeetDef`, keeping the same shape.)

- [ ] **Step 3: Run the agent-core suite and typecheck**

Run: `cd packages/agent-core && bun test && bun run typecheck`
Expected: all tests PASS, no typecheck errors. (A missing-export or wrong-path error here means Step 1 or 2 has a typo — double check the import path `./composio/google-maps.js`.)

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/connectors/all-defs.ts packages/agent-core/src/index.ts
git commit -m "feat: register google maps connector in agent-core registry"
```

---

### Task 5: Wire the connector into the backend

**Files:**
- Modify: `apps/backend/src/connectors/composio-defs.ts`
- Modify: `.env.example` (repo root)

**Interfaces:**
- Consumes: `makeComposioMapsDef` from `@yomi/agent-core` (Task 4).

- [ ] **Step 1: Add the connector to `buildComposioDefs`**

In `apps/backend/src/connectors/composio-defs.ts`, find:

```ts
import {
  makeComposioLinearDef, makeComposioGitHubDef, makeComposioSlackDef, makeComposioNotionDef,
  makeComposioGmailDef, makeComposioCalendarDef, makeComposioDriveDef, makeComposioClassroomDef,
  makeComposioTasksDef, makeComposioMeetDef, makeComposioDocsDef, makeComposioSheetsDef, makeComposioSlidesDef,
  type ConnectorDef, type ComposioExecutor,
} from "@yomi/agent-core"
import { createComposioRestExecutor } from "./composio-executor.js"
```

Replace with:

```ts
import {
  makeComposioLinearDef, makeComposioGitHubDef, makeComposioSlackDef, makeComposioNotionDef,
  makeComposioGmailDef, makeComposioCalendarDef, makeComposioDriveDef, makeComposioClassroomDef,
  makeComposioTasksDef, makeComposioMeetDef, makeComposioDocsDef, makeComposioSheetsDef, makeComposioSlidesDef,
  makeComposioMapsDef,
  type ConnectorDef, type ComposioExecutor,
} from "@yomi/agent-core"
import { createComposioRestExecutor } from "./composio-executor.js"
```

Then find:

```ts
    "google-classroom": makeComposioClassroomDef(exec),
    "google-tasks": makeComposioTasksDef(exec),
    "google-meet": makeComposioMeetDef(exec),
  }
}
```

Replace with:

```ts
    "google-classroom": makeComposioClassroomDef(exec),
    "google-tasks": makeComposioTasksDef(exec),
    "google-meet": makeComposioMeetDef(exec),
    "google-maps": makeComposioMapsDef(exec),
  }
}
```

- [ ] **Step 2: Document the new env var in `.env.example`**

In `.env.example` (repo root), find:

```
COMPOSIO_TASKS_AUTH_CONFIG_ID=
COMPOSIO_MEET_AUTH_CONFIG_ID=
```

Replace with:

```
COMPOSIO_TASKS_AUTH_CONFIG_ID=
COMPOSIO_MEET_AUTH_CONFIG_ID=
COMPOSIO_MAPS_AUTH_CONFIG_ID=
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/connectors/composio-defs.ts .env.example
git commit -m "feat: wire google maps connector into backend composio defs"
```

---

### Task 6: Connector icon and catalog entry

**Files:**
- Modify: `packages/ui-connectors/src/icons.tsx`
- Modify: `packages/ui-connectors/src/catalog.ts`

**Interfaces:**
- No new exports consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add `GoogleMapsIcon` and register it**

In `packages/ui-connectors/src/icons.tsx`, find the end of `GoogleMeetIcon`:

```ts
function GoogleMeetIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 45.4 512 421.2" fill="none" role="img" aria-label="Google Meet">
      <path d="m289.6 256 49.9 57 67.1 42.9 11.7-99.6-11.7-97.3-68.4 37.7z" fill="#00832d" />
      <path d="M0 346.7v84.8c0 19.4 15.7 35.1 35.1 35.1h84.8l17.6-64.1-17.6-55.8-58.2-17.6z" fill="#0066da" />
      <path d="M119.9 45.4 0 165.3l61.7 17.6 58.2-17.6 17.3-55.1z" fill="#e94235" />
      <path d="M119.9 165.3H0v181.4h119.9z" fill="#2684fc" />
      <path d="M483.3 96.2 406.6 159v196.9l77 63.1c11.5 9 28.4.8 28.4-13.9V109.7c0-14.8-17.2-22.9-28.7-13.5M289.6 256v90.7H119.9v119.9h251.6c19.4 0 35.1-15.7 35.1-35.1v-75.6z" fill="#00ac47" />
      <path d="M371.5 45.4H119.9v119.9h169.7V256l117-96.9V80.5c0-19.4-15.7-35.1-35.1-35.1" fill="#ffba00" />
    </svg>
  )
}
```

Replace with:

```ts
function GoogleMeetIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 45.4 512 421.2" fill="none" role="img" aria-label="Google Meet">
      <path d="m289.6 256 49.9 57 67.1 42.9 11.7-99.6-11.7-97.3-68.4 37.7z" fill="#00832d" />
      <path d="M0 346.7v84.8c0 19.4 15.7 35.1 35.1 35.1h84.8l17.6-64.1-17.6-55.8-58.2-17.6z" fill="#0066da" />
      <path d="M119.9 45.4 0 165.3l61.7 17.6 58.2-17.6 17.3-55.1z" fill="#e94235" />
      <path d="M119.9 165.3H0v181.4h119.9z" fill="#2684fc" />
      <path d="M483.3 96.2 406.6 159v196.9l77 63.1c11.5 9 28.4.8 28.4-13.9V109.7c0-14.8-17.2-22.9-28.7-13.5M289.6 256v90.7H119.9v119.9h251.6c19.4 0 35.1-15.7 35.1-35.1v-75.6z" fill="#00ac47" />
      <path d="M371.5 45.4H119.9v119.9h169.7V256l117-96.9V80.5c0-19.4-15.7-35.1-35.1-35.1" fill="#ffba00" />
    </svg>
  )
}

function GoogleMapsIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" role="img" aria-label="Google Maps">
      <path
        d="M310.1 8.5c-17-5.4-35.6-8.5-54.5-8.5C201.1 0 152 24.7 119.1 63.8l84.3 70.8z"
        fill="#1a73e8"
      />
      <path
        d="M119.1 63.8C93.2 94.7 77.3 135 77.3 178.3c0 33.6 6.6 60.7 17.8 85.1l108.3-128.8z"
        fill="#ea4335"
      />
      <path
        d="M256 110.2c37.9 0 68.4 30.5 68.4 68.4 0 16.6-6.2 32.1-16.2 44.1 0 0 53.8-64.2 106.3-126.5-21.7-41.8-59.2-73.5-104.4-87.8L203.4 134.6c12.8-14.7 31.3-24.4 52.6-24.4"
        fill="#4285f4"
      />
      <path
        d="M256 246.7c-37.9 0-68.4-30.5-68.4-68.4 0-16.6 5.8-32.1 15.9-43.7L95.1 263.3c18.6 41 49.5 74.2 81.2 115.6l131.9-156.6c-12.8 15.1-31.3 24.4-52.2 24.4"
        fill="#fbbc04"
      />
      <path
        d="M305.9 422.3c59.6-93.2 128.8-135.3 128.8-243.6 0-29.8-7.3-57.6-20.1-82.4L176.3 379c10.1 13.1 20.5 28.2 30.5 43.7 36.4 56.1 26.3 89.3 49.5 89.3s13.2-33.6 49.6-89.7"
        fill="#34a853"
      />
    </svg>
  )
}
```

Then find the `ICON_MAP` object:

```ts
const ICON_MAP: Record<string, React.FC<IconProps>> = {
  google: GmailIcon,
  gmail: GmailIcon,
  "google-gmail": GmailIcon,
  "google-calendar": GoogleCalendarIcon,
  "google-drive": GoogleDriveIcon,
  "google-docs": GoogleDocsIcon,
  "google-sheets": GoogleSheetsIcon,
  "google-slides": GoogleSlidesIcon,
  "google-classroom": GoogleClassroomIcon,
  "google-tasks": GoogleTasksIcon,
  "google-meet": GoogleMeetIcon,
  github: GitHubIcon,
  notion: NotionIcon,
  slack: SlackIcon,
  linear: LinearIcon,
  telegram: TelegramIcon,
  swiggy: SwiggyIcon,
}
```

Replace with:

```ts
const ICON_MAP: Record<string, React.FC<IconProps>> = {
  google: GmailIcon,
  gmail: GmailIcon,
  "google-gmail": GmailIcon,
  "google-calendar": GoogleCalendarIcon,
  "google-drive": GoogleDriveIcon,
  "google-docs": GoogleDocsIcon,
  "google-sheets": GoogleSheetsIcon,
  "google-slides": GoogleSlidesIcon,
  "google-classroom": GoogleClassroomIcon,
  "google-tasks": GoogleTasksIcon,
  "google-meet": GoogleMeetIcon,
  "google-maps": GoogleMapsIcon,
  github: GitHubIcon,
  notion: NotionIcon,
  slack: SlackIcon,
  linear: LinearIcon,
  telegram: TelegramIcon,
  swiggy: SwiggyIcon,
}
```

- [ ] **Step 2: Add the catalog entry**

In `packages/ui-connectors/src/catalog.ts`, find the `google-docs` entry:

```ts
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Create and edit richly formatted Google Docs from Markdown.",
    category: "productivity",
    authKind: "composio",
    icon: "file-text",
    available: true,
  },
```

Add this entry immediately after it:

```ts
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Search for places and businesses near a location.",
    category: "productivity",
    authKind: "composio",
    icon: "map-pin",
    available: true,
  },
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd packages/ui-connectors && bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui-connectors/src/icons.tsx packages/ui-connectors/src/catalog.ts
git commit -m "feat: add google maps connector icon and catalog entry"
```

---

### Task 7: Manual verification pass

**Files:** none (verification only), plus a local-only, uncommitted edit to `apps/backend/.env`.

- [ ] **Step 1: Run the full test suite and repo-wide typecheck/lint**

Run from repo root: `bun run test && bun run typecheck && bun run lint`
Expected: all packages pass; only pre-existing warnings (if any) remain, no new errors.

- [ ] **Step 2: Enable the connector locally**

`apps/backend/.env` is git-ignored — this step edits your local copy only, never committed. Find:

```
COMPOSIO_CONNECTORS=github,linear,google,google-calendar,google-drive,google-docs,google-sheets,google-slides,google-classroom,google-tasks,google-contacts,google-meet
```

Add `google-maps` to the comma list, and add the auth config id line right after the existing `COMPOSIO_MEET_AUTH_CONFIG_ID=...` line:

```
COMPOSIO_MAPS_AUTH_CONFIG_ID=ac_pDcfNJ-uh2vw
```

- [ ] **Step 3: Start the backend dev server**

Run: `cd apps/backend && bun run dev`

- [ ] **Step 4: Manually verify against the spec's Testing section**

Check each of the following (from `docs/superpowers/specs/2026-07-20-geolocation-support-design.md`):

1. In your own Telegram chat with the dev/staging bot, share a location pin. Confirm (via backend logs — look for `[gateway] location received: ...`) that it's received and not silently dropped.
2. Connect the Google Maps connector from your dashboard (OAuth2 flow against the `ac_pDcfNJ-uh2vw` auth config).
3. Ask a location-dependent question after sharing a pin, e.g. "what's near here" or "find a coffee shop near Koramangala". Confirm the agent calls `GOOGLE_MAPS_NEARBY_SEARCH` or `GOOGLE_MAPS_TEXT_SEARCH` (visible in backend logs / the tool-call trace) and returns real results, with no approval prompt (both are read-only).
4. Confirm a message that's ONLY a location pin (no other text) still gets a sensible agent reply, not a dropped/ignored message.

- [ ] **Step 5: Fix any issues found, then re-run Steps 1**

If Step 4 surfaces a bug, fix it in the relevant file from Tasks 1–6, re-run the test/typecheck/lint commands, and re-verify before proceeding.

- [ ] **Step 6: Final commit (only if Step 5 required changes)**

```bash
git add -A
git commit -m "fix: address manual verification findings on geolocation support"
```

If Step 4 passed with no changes needed, skip this commit — Task 6's commit is the last one.
