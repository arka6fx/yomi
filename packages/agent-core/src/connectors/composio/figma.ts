import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const FIGMA_TOOLKIT = "figma"

export const figmaComposioSpecs: ComposioToolSpec[] = [
  // ── Read / Search actions ─────────────────────────────────────
  {
    slug: "FIGMA_DISCOVER_FIGMA_RESOURCES",
    description:
      "Smart Figma resource discovery — extract file_key, project_id, and team_id from any Figma URL. Read-only.",
    parameters: z
      .object({
        url: z.string().describe("A Figma URL (e.g. https://www.figma.com/design/ABC123/Name)"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_FILE_JSON",
    description:
      "Get the full Figma design file JSON with automatic simplification. Returns clean, AI-friendly format with CSS-like property names and deduplicated variables. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key from the URL (e.g. 'ABC123xyz')"),
        simplify: z.coerce
          .boolean()
          .optional()
          .describe("Simplify output for AI consumption (default true)"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_CURRENT_USER",
    description: "Get details of the currently authenticated Figma user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "FIGMA_GET_FILE_COMPONENTS",
    description: "Get all components and component metadata in a Figma file. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_FILE_STYLES",
    description:
      "Get all styles in a Figma file including text, fill, effect, and grid styles. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_COMMENTS_IN_A_FILE",
    description:
      "Get all comments from a Figma file, including author, position, and reactions. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
        markdown: z.coerce.boolean().optional().describe("Return comments formatted as Markdown"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_VERSIONS_OF_A_FILE",
    description: "Get the version history for a Figma file. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_PROJECTS_IN_A_TEAM",
    description:
      "Get all projects within a Figma team that are visible to the authenticated user. Read-only.",
    parameters: z
      .object({
        team_id: z.string().describe("The Figma team ID"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_FILES_IN_A_PROJECT",
    description: "Get a list of files in a Figma project, including branch metadata. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("The Figma project ID"),
        branch_data: z.coerce.boolean().optional().describe("Include branch metadata"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_LOCAL_VARIABLES",
    description: "Get all local variables and variable collections in a Figma file. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_EXTRACT_DESIGN_TOKENS",
    description:
      "Extract design tokens (colors, typography, spacing) from a Figma file by combining styles, variables, and node-extracted values. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_EXTRACT_PROTOTYPE_INTERACTIONS",
    description: "Extract prototype interactions and animations from a Figma file. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_RENDER_IMAGES_OF_FILE_NODES",
    description:
      "Render Figma nodes as images (PNG, JPG, SVG, PDF). Returns temporary image URLs valid for 30 days. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
        ids: z.string().describe("Comma-separated node IDs to render (e.g. '1:2,1:3')"),
        format: z.string().optional().describe("Output format: 'png', 'jpg', 'svg', or 'pdf'"),
        scale: z
          .number()
          .min(0.01)
          .max(4)
          .optional()
          .describe("Image scale (0.01-4.0) for raster formats"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_DOWNLOAD_FIGMA_IMAGES",
    description:
      "Download images from Figma file nodes. Renders specified nodes as image files. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
        images: z
          .array(
            z.object({
              node_id: z.string(),
              file_name: z.string(),
              format: z.string().optional(),
            }),
          )
          .describe(
            "Array of node images to download: each with node_id, file_name, and optional format",
          ),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_GET_TEAM_COMPONENTS",
    description: "Get all components in a Figma team library. Read-only.",
    parameters: z
      .object({
        team_id: z.string().describe("The Figma team ID"),
      })
      .passthrough(),
  },
  {
    slug: "FIGMA_DETECT_BACKGROUND",
    description:
      "Detect background layers for selected nodes in a Figma file. Analyzes document structure to identify potential background elements. Read-only.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
        node_ids: z.array(z.string()).describe("Array of node IDs to detect backgrounds for"),
      })
      .passthrough(),
  },

  // ── Write / Execute actions (gated) ───────────────────────────
  {
    slug: "FIGMA_ADD_A_COMMENT_TO_A_FILE",
    description:
      "Post a new comment to a Figma file, optionally replying to an existing comment. Requires user approval before it runs.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
        message: z.string().describe("The comment text"),
        comment_id: z.string().optional().describe("Optional: reply to an existing comment by ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Comment on ${String(a["file_key"] ?? "")}`,
      preview: `Add comment to Figma file ${String(a["file_key"] ?? "")}`,
      confirmText: "Add comment",
    }),
  },
  {
    slug: "FIGMA_DESIGN_TOKENS_TO_TAILWIND",
    description:
      "Convert previously extracted design tokens to a Tailwind CSS configuration. Requires FIGMA_EXTRACT_DESIGN_TOKENS to have been called first. Requires user approval before it runs.",
    parameters: z
      .object({
        tokens: z.any().describe("The DesignTokens object from FIGMA_EXTRACT_DESIGN_TOKENS"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Generate Tailwind config",
      preview: "Convert design tokens to Tailwind CSS configuration",
      confirmText: "Generate",
    }),
  },
  {
    slug: "FIGMA_CREATE_DEV_RESOURCES",
    description:
      "Create dev resources (developer handoff links, e.g. a Jira ticket or GitHub issue URL) for Figma file nodes, up to 10 per node. Requires user approval before it runs.",
    parameters: z
      .object({
        dev_resources: z
          .array(
            z
              .object({
                name: z.string().describe("Visible name for the dev resource in Figma"),
                url: z
                  .string()
                  .describe("URL for the dev resource, e.g. a Jira ticket or GitHub issue"),
                file_key: z.string().describe("The Figma file key"),
                node_id: z.string().describe("Node ID to attach the resource to"),
              })
              .passthrough(),
          )
          .describe("Dev resources to create"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create dev resources",
      preview: `Create ${String((a["dev_resources"] as unknown[])?.length ?? 0)} dev resource(s)`,
      confirmText: "Create dev resources",
    }),
  },

  // ── Irreversible actions (gated, flagged) ────────────────────
  {
    slug: "FIGMA_DELETE_A_COMMENT",
    description: "Delete a comment from a Figma file. This action is irreversible.",
    parameters: z
      .object({
        file_key: z.string().describe("The Figma file key"),
        comment_id: z.string().describe("The ID of the comment to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete comment",
      preview: `Delete comment ${String(a["comment_id"] ?? "")} from ${String(a["file_key"] ?? "")}`,
      confirmText: "Delete comment",
    }),
  },
]

export function makeComposioFigmaDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "figma",
    name: "Figma",
    category: "design",
    icon: "figma",
    description:
      "Browse designs, extract components and tokens, manage comments, and render assets from Figma (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: FIGMA_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_FIGMA_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Figma auth config in Composio with your Figma OAuth credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_FIGMA_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=figma to route Figma through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_FIGMA_AUTH_CONFIG_ID",
          label: "Composio Figma auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/figma",
    },
    tools: createComposioTools({
      provider: "figma",
      toolkit: FIGMA_TOOLKIT,
      specs: figmaComposioSpecs,
      executor,
    }),
  }
}
