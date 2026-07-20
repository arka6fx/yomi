# Geolocation Support (Telegram Location + Google Maps Connector) — Design

Date: 2026-07-20
Status: Approved (design); pending implementation plan

## Summary

Add geolocation support to Yomi in two paired pieces: (1) parse Telegram's
native `message.location` field (currently silently dropped) so a
user-shared pin reaches the agent as context, and (2) add a Google Maps
connector via Composio so the agent can act on that location — search
nearby or search by place name. Neither piece is useful alone: raw
coordinates without Maps tools are inert context; Maps tools without
location ingestion have no way to receive "here" from the user.

## Scope (v1)

- **In scope:** Telegram static-pin location parsing (one-time share, not
  live/continuously-updating location), a `location` field on
  `GatewayMessage`, plain-text coordinate context injection (no automatic
  reverse-geocode call), and a 2-tool Google Maps Composio connector
  (nearby search, text search) — both live-verified to work via the
  existing OAuth2 connection with no separate Maps API key.
- **Out of scope:** Telegram "live location" (continuous `edited_message`
  updates), automatic/eager reverse-geocoding on every location share,
  `GOOGLE_MAPS_GEOCODING_API` and `GOOGLE_MAPS_GET_DIRECTION` (both
  live-verified to require a classic Google Maps Platform API key — Google
  never added OAuth support for these legacy Geocoding/Directions
  endpoints, regardless of Composio auth mode; deferred until a Maps key
  is provisioned), `GOOGLE_MAPS_GET_ROUTE` (overlaps with `GET_DIRECTION`,
  same key requirement), `GOOGLE_MAPS_DISTANCE_MATRIX_API` (no concrete
  use case yet, same key requirement), `GOOGLE_MAPS_MAPS_EMBED_API`
  (produces an iframe embed URL, useless in a text-based Telegram chat).

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

**2 tools for v1** — verified against Composio's live API (`GET
/api/v3/tools?toolkit_slug=google_maps` for the real slug/param list, then
a live test call against a throwaway OAuth-connected test account for
each candidate tool — not marketing copy, and not assumption):

| Slug | Purpose | Verified |
| --- | --- | --- |
| `GOOGLE_MAPS_NEARBY_SEARCH` | "What's near this point" — takes lat/lon directly, the natural pairing with a Telegram-shared pin | Live call succeeded via OAuth2 alone, real results returned |
| `GOOGLE_MAPS_TEXT_SEARCH` | Free-text place search (e.g. "pharmacy near Koramangala") | Live call succeeded via OAuth2 alone, real results returned |

Deferred (see Scope): `GEOCODING_API` and `GET_DIRECTION` (both
live-verified to require a classic Maps API key — `GEOCODING_API` failed
with `"missing: key"`, `GET_DIRECTION` failed with `"You must use an API
key to authenticate each request to Google Maps Platform APIs"`, both
under the same active OAuth2 connection that succeeded for the two tools
above), `GET_ROUTE`, `DISTANCE_MATRIX_API`, `MAPS_EMBED_API`.

Both are read-only (no state changes on Google's side) — classified as
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
- Setup steps mirror Calendar's. No Google Maps Platform API key or GCP
  billing setup is needed for v1's 2 tools (see Resolved section) — this
  connector is "connect and go" the same as every other Composio
  connector Yomi has. A future note about Maps Platform billing only
  becomes relevant if `GEOCODING_API`/`GET_DIRECTION` are added later.

Registered in `all-defs.ts`/`registry.ts` the same way every other
Composio connector is — gated behind `COMPOSIO_CONNECTORS` including
`google-maps`. Because auth is OAuth2 (not a shared API key), this
connector is a normal per-user toggle in the dashboard like every other
connector — no special-casing needed for "always-on" availability.

## Resolved during design (live-tested, not guessed)

Both items originally flagged as "resolve at implementation time" were
resolved during design instead, via a throwaway test connected account
against the real `ac_pDcfNJ-uh2vw` auth config (created, tested, and
deleted in the same session):

1. **`GEOCODING_API`'s `key` requirement is not Composio-fillable under
   OAuth2** — confirmed by a live call that failed with `"missing: key"`
   despite an active OAuth2 connection. This is a Google API limitation
   (the legacy Geocoding/Directions APIs never accepted OAuth), not
   something Composio or Yomi's adapter can work around. Resolution: both
   tools are deferred (see Scope) rather than building adapter
   infrastructure to inject a key Yomi doesn't have yet.
2. **Billing exposure for v1's 2 tools is none** — `NEARBY_SEARCH` and
   `TEXT_SEARCH` both succeeded live via the Composio-managed OAuth
   connection alone, meaning whatever GCP project/billing sits behind
   that connection is Composio's, not Yomi's or the end user's. These
   calls are metered as ordinary Composio tool calls, already covered by
   Yomi's existing per-call credit gating — no separate Maps Platform
   billing setup needed for this round. This will need revisiting if
   `GEOCODING_API`/`GET_DIRECTION` are added later, since those require a
   real Maps Platform API key tied to a real billing account.

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
  ("what's near here", "find a coffee shop near Koramangala") and confirm
  the agent calls `NEARBY_SEARCH`/`TEXT_SEARCH` appropriately.
- `bun run typecheck` and `bun run lint` clean before considering this
  done (project convention).

## Future (explicitly deferred)

Telegram live location (continuous tracking), automatic reverse-geocoding
on receipt, `GEOCODING_API`/`GET_DIRECTION`/`GET_ROUTE`/
`DISTANCE_MATRIX_API`/`MAPS_EMBED_API` tools (all four require a real
Google Maps Platform API key — see Resolved section above — revisit once
one is provisioned and its billing is understood), a dedicated
`ConnectorCategory` for location-type connectors if more get added later.
