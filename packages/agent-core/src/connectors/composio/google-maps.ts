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
// Neither tool below returns a route, distance, ETA, or resolved "you are here"
// location — GEOCODING_API and GET_DIRECTION are excluded entirely (see above),
// so there is no tool result to ground any of that in. Without this stated
// directly, the model tends to treat a place-search match's coordinates as if
// they answered a routing question and improvise a route/neighborhood on top —
// producing confident-sounding but fabricated directions. Relay only the literal
// fields a search result contains; never state a route, drive time, or "you're
// near X" claim that isn't one of those fields.
const NO_ROUTING =
  " This does not compute directions, routes, distances, or ETAs, and there is no such tool available at all — never offer or state a route, driving time, or resolved current-location claim; if asked for directions, say routing isn't supported and suggest opening Google Maps directly."

export const mapsComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLE_MAPS_NEARBY_SEARCH",
    description: `Search for places (restaurants, parks, pharmacies, etc.) within a circular area around a coordinate. Takes lat/lon directly — the natural fit right after a user shares a location pin. Read-only.${NO_ROUTING}`,
    parameters: z
      .object({
        latitude: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude of the search center, in decimal degrees"),
        longitude: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude of the search center, in decimal degrees"),
        radius: z
          .number()
          .min(0)
          .max(50000)
          .describe("Radius of the search area in meters (max 50000)"),
        includedTypes: z
          .array(z.string())
          .optional()
          .describe(
            "Place types to include, e.g. ['restaurant'] or ['atm', 'bank'] — results match at least one",
          ),
        excludedTypes: z
          .array(z.string())
          .optional()
          .describe(
            "Place types to exclude, e.g. ['cafe'] — results matching any of these are omitted",
          ),
        maxResultCount: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max results to return (default 10)"),
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
    description: `Search for places using a free-text query, e.g. 'coffee shops near Koramangala' or 'Eiffel Tower'. Matches against place name, address, and category. Read-only.${NO_ROUTING}`,
    parameters: z
      .object({
        textQuery: z
          .string()
          .describe(
            "Free-text search query, e.g. 'restaurants in London' or 'coffee shops near me'",
          ),
        maxResultCount: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max results to return (default 10)"),
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
    description:
      "Search for places and businesses near a location (via Composio). Place search only — cannot provide directions, routes, distances, or ETAs; no such capability exists.",
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
        {
          env: "COMPOSIO_MAPS_AUTH_CONFIG_ID",
          label: "Composio Maps auth config id",
          secret: false,
        },
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
