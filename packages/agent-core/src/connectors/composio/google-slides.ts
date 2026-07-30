import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const SLIDES_TOOLKIT = "googleslides"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googleslides) before writing this file — see
// the Drive connector's history for why (hallucinated slugs there 404'd on
// every real call). This toolkit only has 6 actions total, so the curated set
// below is the full toolkit.
//
// The markdown deck builder (CREATE_SLIDES_MARKDOWN / BATCH_UPDATE's
// markdown_text) does real slide layout: auto-detects title/bullet/table/quote/
// image/two-column slides, auto-sizes fonts to avoid overflow, and supports
// named themes — this is what replaces the old native connector's hand-rolled
// Slides-batchUpdate deck builder.
export const slidesComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLESLIDES_PRESENTATIONS_GET",
    description:
      "Fetch a Google Slides presentation's structure: slides, page elements, layouts. Read-only.",
    parameters: z
      .object({
        presentationId: z.string().describe("Google Slides presentation ID"),
        fields: z
          .string()
          .optional()
          .describe("Comma-separated field selector, e.g. 'presentationId,title,slides'"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESLIDES_PRESENTATIONS_PAGES_GET",
    description: "Fetch a single slide (page) from a presentation by its object ID. Read-only.",
    parameters: z
      .object({
        presentationId: z.string().describe("Google Slides presentation ID"),
        pageObjectId: z.string().describe("Object ID of the slide/page to fetch"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLESLIDES_PRESENTATIONS_PAGES_GET_THUMBNAIL",
    description: "Get a PNG or JPEG thumbnail image URL for one slide. Read-only.",
    parameters: z
      .object({
        presentationId: z.string().describe("Google Slides presentation ID"),
        pageObjectId: z.string().describe("Object ID of the slide to thumbnail"),
        "thumbnailProperties.mimeType": z.enum(["PNG", "JPEG"]).optional(),
        "thumbnailProperties.thumbnailSize": z.enum(["LARGE", "MEDIUM", "SMALL"]).optional(),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLESLIDES_CREATE_SLIDES_MARKDOWN",
    description:
      "Create a new Google Slides presentation from Markdown, with real multi-slide layout and auto-sizing. " +
      "Separate slides with a line containing only '---'. First slide is the title slide: '# Title\\nSubtitle'. " +
      "Bullets: lines starting with '•', '-', or '*'. Tables: standard Markdown tables. Quotes: '> text'. " +
      "Images: '![alt](https://publicly-accessible-url)' (PNG/JPEG/GIF, under 50MB, must be a stable public URL — " +
      "placeholder/dynamic-generation services like picsum.photos are blocked). Two columns on one slide: separate " +
      "with a line containing only '|||'. Optionally start the markdown with a theme line, e.g. 'Theme: corporate_blue' " +
      "(other themes: modern_dark, professional_gray, creative_purple, warm_orange, forest_green, minimal_beige, default). " +
      "Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Title for the new presentation"),
        markdown_text: z
          .string()
          .describe("Deck content as Markdown — see tool description for syntax"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Slides deck: ${String(a["title"] ?? "")}`,
      preview: String(a["markdown_text"] ?? "").slice(0, 500),
      confirmText: "Create deck",
    }),
  },
  {
    slug: "GOOGLESLIDES_PRESENTATIONS_CREATE",
    description:
      "Create a new, empty Google Slides presentation, or duplicate an existing one via duplicatePresentationId. " +
      "For a real multi-slide deck from content, prefer GOOGLESLIDES_CREATE_SLIDES_MARKDOWN instead. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().optional().describe("Title for the new presentation"),
        duplicatePresentationId: z
          .string()
          .optional()
          .describe("Existing presentation ID to copy instead of creating blank"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["duplicatePresentationId"]
        ? "Duplicate a Slides presentation"
        : "Create an empty Slides presentation",
      preview: String(a["title"] ?? ""),
      confirmText: "Create presentation",
    }),
  },
  {
    slug: "GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE",
    description:
      "Add more Markdown-formatted slides to an EXISTING presentation (same Markdown syntax as GOOGLESLIDES_CREATE_SLIDES_MARKDOWN), " +
      "or apply raw Slides API batchUpdate requests for fine-grained edits (move/resize/restyle elements). Requires user approval before it runs.",
    parameters: z
      .object({
        presentationId: z.string().describe("Google Slides presentation ID to update"),
        markdown_text: z
          .string()
          .optional()
          .describe("Markdown for new slides to append. Omit if using requests."),
        requests: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("Raw Slides API batchUpdate request objects. Omit if using markdown_text."),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update Slides presentation ${String(a["presentationId"] ?? "").slice(0, 12)}`,
      preview: a["markdown_text"]
        ? String(a["markdown_text"]).slice(0, 500)
        : "Apply raw batchUpdate requests",
      confirmText: "Update deck",
    }),
  },
]

export function makeComposioSlidesDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-slides",
    name: "Google Slides",
    category: "productivity",
    icon: "google-slides",
    description:
      "Build multi-slide presentations from Markdown and edit existing decks (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: SLIDES_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SLIDES_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_SLIDES_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-slides to route Slides through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_SLIDES_AUTH_CONFIG_ID",
          label: "Composio Slides auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googleslides",
    },
    tools: createComposioTools({
      provider: "google-slides",
      toolkit: SLIDES_TOOLKIT,
      specs: slidesComposioSpecs,
      executor,
    }),
  }
}
