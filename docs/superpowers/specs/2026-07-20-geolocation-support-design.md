# Geolocation Support (Telegram Location + Google Maps Connector) — Design

Date: 2026-07-20
Status: Approved (design); pending implementation plan

## Summary

Add geolocation support to Yomi in two paired pieces: (1) parse Telegram's
native `message.location` field (currently silently dropped) so a
user-shared pin reaches the agent as context, and (2) add a Google Maps
connector via Composio so the agent can act on that location — reverse-
geocode it, search nearby, or get directions. Neither piece is useful
alone: raw coordinates without Maps tools are inert context; Maps tools
without location ingestion have no way to receive "here" from the user.

## Scope (v1)

- **In scope:** Telegram static-pin location parsing (one-time share, not
  live/continuously-updating location), a `location` field on
  `GatewayMessage`, plain-text coordinate context injection (no automatic
  reverse-geocode call), and a 4-tool Google Maps Composio connector
  (geocoding, nearby search, text search, directions).
- **Out of scope:** Telegram "live location" (continuous `edited_message`
  updates), automatic/eager reverse-geocoding on every location share,
  `GOOGLE_MAPS_GET_ROUTE` (overlaps with `GET_DIRECTION`),
  `GOOGLE_MAPS_DISTANCE_MATRIX_API` (no concrete use case yet),
  `GOOGLE_MAPS_MAPS_EMBED_API` (produces an iframe embed URL, useless in a
  text-based Telegram chat).

## Part 1: Telegram location ingestion

**`TelegramUpdate`** (`apps/backend/src/gateway/platforms/telegram.ts`)
gets a new optional field on `message`:

```ts
location?: { latitude: number; longitude: number }
```

**`GatewayMessage`** (`packages/shared/src/index.ts`) gets a matching
optional field, alongside the existing `audioUrl`/`imageUrl`/`documentUrl`/
`videoUrl` attachment fields:

```ts
/** Coordinates when the user shared a location pin */
location?: { latitude: number; longitude: number }
```

**`TelegramAdapter.processUpdate`** reads `msg.location`, includes it on
the constructed `GatewayMessage`, and the early-return guard gains
`&& !msg.location` so a bare pin-share isn't dropped:

```ts
if (!hasText && !voiceFile && !imageFile && !documentFile && !msg.video && !msg.location) return
```

**`gateway-runner.ts`** gets a new block, alongside the existing
audio/image/document/video pre-processing blocks (around the existing
`msg.audioUrl`/`msg.imageUrl`/etc. handlers), that turns `msg.location`
into plain context text appended before the agent turn:

```
[User shared their location: 12.9716, 77.5946]
```

No automatic reverse-geocoding call. Unlike a voice note or photo (unusable
to the model without processing), raw coordinates are already legible to
the LLM and to any Maps tool call it decides to make. An eager
reverse-geocode on every pin-share would add latency/cost the user didn't
ask for; the agent calls Maps tools itself when the user's message implies
it wants to act on the location (mirroring how it already decides when to
call Gmail/Calendar tools).

## Part 2: Google Maps connector

New file `packages/agent-core/src/connectors/composio/google-maps.ts`,
same shape as `google-calendar.ts`: a `mapsComposioSpecs:
ComposioToolSpec[]` array + `makeComposioMapsDef(executor)` factory.

**4 tools for v1** (verified against Composio's live API — `GET
/api/v3/tools?toolkit_slug=google_maps` — not marketing copy, which listed
more actions than actually exist):

| Slug | Purpose |
| --- | --- |
| `GOOGLE_MAPS_GEOCODING_API` | Address ⇄ coordinates — turns a shared pin into a readable address, or a place name into coordinates |
| `GOOGLE_MAPS_NEARBY_SEARCH` | "What's near this point" — takes lat/lon directly |
| `GOOGLE_MAPS_TEXT_SEARCH` | Free-text place search (e.g. "pharmacy near Koramangala") |
| `GOOGLE_MAPS_GET_DIRECTION` | Route + travel mode between two points |

Deferred (see Scope): `GET_ROUTE`, `DISTANCE_MATRIX_API`,
`MAPS_EMBED_API`.

All 4 are read-only (no state changes on Google's side) — classified as
`"read"`, same as Calendar's list/search actions, so no approval gating.

**`makeComposioMapsDef`:**
- `id: "google-maps"`
- `category: "productivity"` — closest existing fit; no dedicated
  location/maps `ConnectorCategory` exists and adding one is more
  footprint than this warrants.
- `icon: "google-maps"` — new `GoogleMapsIcon` component in
  `packages/ui-connectors/src/icons.tsx` (same pattern as
  `GmailIcon`/`GoogleCalendarIcon`: functional component, `<svg
  viewBox="0 0 512 512">`, path `style="fill:..."` attributes converted to
  plain `fill` props), registered as `"google-maps": GoogleMapsIcon`
  alongside the other icons in the same file's icon map, and as a new
  entry in `packages/ui-connectors/src/catalog.ts` matching the
  `google-calendar`/`google-drive` entries' shape.
- `auth: { kind: "composio", toolkit: "google_maps", authConfigIdEnv:
  "COMPOSIO_MAPS_AUTH_CONFIG_ID" }` — OAuth2, Composio-managed credentials
  (auth config already created: `ac_pDcfNJ-uh2vw`).
- Setup steps mirror Calendar's, plus a note that Google Maps Platform
  (Geocoding/Places/Directions) is a metered, billed API regardless of
  auth mode — OAuth vs. API key changes who gets billed, not whether
  billing applies.

Registered in `all-defs.ts`/`registry.ts` the same way every other
Composio connector is — gated behind `COMPOSIO_CONNECTORS` including
`google-maps`. Because auth is OAuth2 (not a shared API key), this
connector is a normal per-user toggle in the dashboard like every other
connector — no special-casing needed for "always-on" availability.

## Open items to resolve at implementation time (not now)

1. **Does `GOOGLE_MAPS_GEOCODING_API`'s `key` field need an explicit
   value, or does Composio auto-fill it under OAuth2?** First
   implementation step: one live test call through the Composio-managed
   OAuth connection. If unfilled, either drop `key` from the tool's zod
   schema and env-inject a fixed value (requires a small addition to
   `createComposioTools`/`adapter.ts`, which has no fixed-param-injection
   mechanism today), or drop the tool for this round if that's not
   cleanly possible.
2. **Whose GCP billing account is actually charged for Maps Platform
   usage under Composio-managed OAuth?** Same live-call step should
   surface this. Not a blocker to implementing, but must be understood
   before rolling the connector out to real users — Maps Platform is a
   paid API with no meaningful free tier comparable to Gmail/Calendar's
   Workspace APIs.

## Testing

- **Unit:** `telegram.ts`'s `processUpdate` — a location-only update (no
  text/voice/image/document/video) produces a `GatewayMessage` with
  `location` set and is not dropped by the early-return guard. Existing
  attachment-type tests continue to pass unchanged.
- **Unit:** the new `gateway-runner.ts` location-context block — given a
  `GatewayMessage` with `location` set, the injected context text contains
  the coordinates in the expected format.
- **Manual:** share a location pin with the Telegram bot in a dev/staging
  environment and confirm the agent receives it as context; separately,
  once the Maps connector is connected, ask a location-dependent question
  ("what's near here", "how far is X from here") and confirm the agent
  calls the appropriate Maps tool.
- `bun run typecheck` and `bun run lint` clean before considering this
  done (project convention).

## Future (explicitly deferred)

Telegram live location (continuous tracking), automatic reverse-geocoding
on receipt, `GET_ROUTE`/`DISTANCE_MATRIX_API`/`MAPS_EMBED_API` tools, a
dedicated `ConnectorCategory` for location-type connectors if more get
added later.
