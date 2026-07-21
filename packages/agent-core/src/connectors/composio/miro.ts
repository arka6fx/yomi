import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const MIRO_TOOLKIT = "miro"

export const miroComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "MIRO_LIST_ORGANIZATIONS",
    description: "List organizations accessible to the user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "MIRO_GET_BOARDS",
    description: "List boards accessible to the user, with optional filters. Read-only.",
    parameters: z.object({
      query: z.string().optional().describe("Search query"),
      team_id: z.string().optional().describe("Filter by team"),
      project_id: z.string().optional().describe("Filter by project"),
      limit: z.number().int().optional().describe("Max results"),
    }).passthrough(),
  },
  {
    slug: "MIRO_GET_BOARD",
    description: "Get details of a specific board. Read-only.",
    parameters: z.object({ board_id: z.string().describe("Board ID") }).passthrough(),
  },
  {
    slug: "MIRO_GET_BOARD_MEMBERS",
    description: "List members of a board. Read-only.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), limit: z.number().int().optional().describe("Max results") }).passthrough(),
  },
  {
    slug: "MIRO_GET_CONNECTORS",
    description: "List connectors (lines linking items) on a board. Read-only.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), limit: z.number().int().optional().describe("Max results") }).passthrough(),
  },
  {
    slug: "MIRO_GET_TAG",
    description: "Get details of a specific tag on a board. Read-only.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), tag_id: z.string().describe("Tag ID") }).passthrough(),
  },
  {
    slug: "MIRO_GET_APP_CARD_ITEM",
    description: "Get details of a specific app card item on a board. Read-only.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), item_id: z.string().describe("Item ID") }).passthrough(),
  },
  {
    slug: "MIRO_CREATE_BOARD",
    description: "Create a new Miro board. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Board name"), description: z.string().optional().describe("Board description") }).passthrough(),
    preview: (a) => ({ title: "Create board", preview: `Create board "${String(a["name"] ?? "")}"`, confirmText: "Create board" }),
  },
  {
    slug: "MIRO_UPDATE_BOARD",
    description: "Update a board's name or description. Requires user approval before it runs.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), name: z.string().optional().describe("New name"), description: z.string().optional().describe("New description") }).passthrough(),
    preview: (a) => ({ title: "Update board", preview: `Update board ${String(a["board_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "MIRO_MIRO_CREATE_APP_CARD_ITEM",
    description: "Add an app card item (rich preview card) to a board. Requires user approval before it runs.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), data: z.record(z.string(), z.unknown()).describe("Card data (title, description, fields)") }).passthrough(),
    preview: (a) => ({ title: "Create app card", preview: `Add app card to board ${String(a["board_id"] ?? "")}`, confirmText: "Add" }),
  },
  {
    slug: "MIRO_UPDATE_APP_CARD_ITEM",
    description: "Update an app card item on a board. Requires user approval before it runs.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), item_id: z.string().describe("Item ID") }).passthrough(),
    preview: (a) => ({ title: "Update app card", preview: `Update item ${String(a["item_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "MIRO_DELETE_ITEM",
    description: "Delete an item (shape, sticky note, etc.) from a board. This cannot be undone.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), item_id: z.string().describe("Item ID") }).passthrough(),
    preview: (a) => ({ title: "Delete item", preview: `Delete item ${String(a["item_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "MIRO_DELETE_APP_CARD_ITEM",
    description: "Delete an app card item from a board. This cannot be undone.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), item_id: z.string().describe("Item ID") }).passthrough(),
    preview: (a) => ({ title: "Delete app card", preview: `Delete app card ${String(a["item_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "MIRO_DELETE_DOCUMENT_ITEM",
    description: "Delete a document item (PDF/image) from a board. This cannot be undone.",
    parameters: z.object({ board_id: z.string().describe("Board ID"), item_id: z.string().describe("Item ID") }).passthrough(),
    preview: (a) => ({ title: "Delete document", preview: `Delete document ${String(a["item_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioMiroDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "miro",
    name: "Miro",
    category: "productivity",
    icon: "miro",
    description: "Miro — collaborative whiteboard platform; browse boards, manage members and app cards (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: MIRO_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MIRO_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Miro auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_MIRO_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=miro to route Miro through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_MIRO_AUTH_CONFIG_ID", label: "Composio Miro auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/miro",
    },
    tools: createComposioTools({
      provider: "miro",
      toolkit: MIRO_TOOLKIT,
      specs: miroComposioSpecs,
      executor,
    }),
  }
}
