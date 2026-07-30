import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const TRELLO_TOOLKIT = "trello"

// Curated subset of Trello's real ~345-tool catalog. Real slugs mirror REST
// paths literally (e.g. GET_BOARDS_BY_ID_BOARD, ADD_CARDS) rather than a clean
// verb-noun convention — this maps the common board/list/card/checklist ops.
export const trelloComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER",
    description: "List boards for a member (use 'me' for the authenticated user). Read-only.",
    parameters: z.object({ idMember: z.string().describe("Member ID, or 'me'") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_BOARDS_BY_ID_BOARD",
    description: "Get details of a specific board. Read-only.",
    parameters: z.object({ idBoard: z.string().describe("Board ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD",
    description: "List lists on a board. Read-only.",
    parameters: z.object({ idBoard: z.string().describe("Board ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD",
    description: "List cards on a board. Read-only.",
    parameters: z.object({ idBoard: z.string().describe("Board ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_BOARDS_MEMBERS_BY_ID_BOARD",
    description: "List members of a board. Read-only.",
    parameters: z.object({ idBoard: z.string().describe("Board ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_BOARDS_LABELS_BY_ID_BOARD",
    description: "List labels on a board. Read-only.",
    parameters: z.object({ idBoard: z.string().describe("Board ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_LISTS_BY_ID_LIST",
    description: "Get details of a specific list. Read-only.",
    parameters: z.object({ idList: z.string().describe("List ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_LISTS_CARDS_BY_ID_LIST",
    description: "List cards in a list. Read-only.",
    parameters: z.object({ idList: z.string().describe("List ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_CARDS_BY_ID_CARD",
    description: "Get details of a specific card. Read-only.",
    parameters: z.object({ idCard: z.string().describe("Card ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_CARDS_CHECKLISTS_BY_ID_CARD",
    description: "List checklists (with items) on a card. Read-only.",
    parameters: z.object({ idCard: z.string().describe("Card ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_CHECKLISTS_BY_ID_CHECKLIST",
    description: "Get details of a specific checklist. Read-only.",
    parameters: z.object({ idChecklist: z.string().describe("Checklist ID") }).passthrough(),
  },
  {
    slug: "TRELLO_GET_MEMBERS_BY_ID_MEMBER",
    description: "Get details of a specific member. Read-only.",
    parameters: z.object({ idMember: z.string().describe("Member ID, or 'me'") }).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "TRELLO_ADD_BOARDS",
    description: "Create a new board. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Board name"),
        desc: z.string().optional().describe("Board description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create board",
      preview: `Create board "${String(a["name"] ?? "")}"`,
      confirmText: "Create board",
    }),
  },
  {
    slug: "TRELLO_ADD_LISTS",
    description: "Create a new list on a board. Requires user approval before it runs.",
    parameters: z
      .object({ name: z.string().describe("List name"), idBoard: z.string().describe("Board ID") })
      .passthrough(),
    preview: (a) => ({
      title: "Create list",
      preview: `Create list "${String(a["name"] ?? "")}"`,
      confirmText: "Create list",
    }),
  },
  {
    slug: "TRELLO_ADD_CARDS",
    description: "Create a new card in a list. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Card name"),
        idList: z.string().describe("List ID"),
        desc: z.string().optional().describe("Card description"),
        due: z.string().optional().describe("Due date (ISO 8601)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create card",
      preview: `Create card "${String(a["name"] ?? "")}"`,
      confirmText: "Create card",
    }),
  },
  {
    slug: "TRELLO_ADD_CHECKLISTS",
    description: "Create a new checklist on a card. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Checklist name"),
        idCard: z.string().describe("Card ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create checklist",
      preview: `Create checklist "${String(a["name"] ?? "")}"`,
      confirmText: "Create checklist",
    }),
  },
  {
    slug: "TRELLO_ADD_CHECKLISTS_CHECK_ITEMS_BY_ID_CHECKLIST",
    description: "Add an item to a checklist. Requires user approval before it runs.",
    parameters: z
      .object({
        idChecklist: z.string().describe("Checklist ID"),
        name: z.string().describe("Item name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add checklist item",
      preview: `Add "${String(a["name"] ?? "")}"`,
      confirmText: "Add item",
    }),
  },
  {
    slug: "TRELLO_ADD_LABELS",
    description: "Create a new label on a board. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Label name"),
        color: z.string().describe("Label color"),
        idBoard: z.string().describe("Board ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create label",
      preview: `Create label "${String(a["name"] ?? "")}"`,
      confirmText: "Create label",
    }),
  },
  {
    slug: "TRELLO_ADD_CARDS_ACTIONS_COMMENTS_BY_ID_CARD",
    description: "Add a comment to a card. Requires user approval before it runs.",
    parameters: z
      .object({ idCard: z.string().describe("Card ID"), text: z.string().describe("Comment text") })
      .passthrough(),
    preview: (a) => ({
      title: "Add comment",
      preview: String(a["text"] ?? "").slice(0, 100),
      confirmText: "Add comment",
    }),
  },
  {
    slug: "TRELLO_ADD_CARDS_ID_MEMBERS_BY_ID_CARD",
    description: "Assign a member to a card. Requires user approval before it runs.",
    parameters: z
      .object({
        idCard: z.string().describe("Card ID"),
        value: z.string().describe("Member ID to add"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Assign member",
      preview: `Assign member to card ${String(a["idCard"] ?? "")}`,
      confirmText: "Assign",
    }),
  },
  {
    slug: "TRELLO_ADD_CARDS_ID_LABELS_BY_ID_CARD",
    description: "Add a label to a card. Requires user approval before it runs.",
    parameters: z
      .object({
        idCard: z.string().describe("Card ID"),
        value: z.string().describe("Label ID to add"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add label",
      preview: `Add label to card ${String(a["idCard"] ?? "")}`,
      confirmText: "Add label",
    }),
  },
  {
    slug: "TRELLO_UPDATE_CARDS_BY_ID_CARD",
    description:
      "Update a card's name, description, due date, or other attributes. Requires user approval before it runs.",
    parameters: z.object({ idCard: z.string().describe("Card ID") }).passthrough(),
    preview: (a) => ({
      title: "Update card",
      preview: `Update card ${String(a["idCard"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "TRELLO_UPDATE_CARDS_ID_LIST_BY_ID_CARD",
    description: "Move a card to a different list. Requires user approval before it runs.",
    parameters: z
      .object({
        idCard: z.string().describe("Card ID"),
        value: z.string().describe("Destination list ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Move card",
      preview: `Move card ${String(a["idCard"] ?? "")}`,
      confirmText: "Move",
    }),
  },
  {
    slug: "TRELLO_UPDATE_CHECKLIST_ITEM_BY_IDS",
    description:
      "Update a checklist item's state (complete/incomplete), name, or position. Requires user approval before it runs.",
    parameters: z
      .object({
        idCard: z.string().describe("Card ID"),
        idChecklistCurrent: z.string().describe("Checklist ID"),
        idCheckItem: z.string().describe("Check item ID"),
        state: z.string().optional().describe("'complete' or 'incomplete'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update checklist item",
      preview: `Update item ${String(a["idCheckItem"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "TRELLO_UPDATE_LISTS_BY_ID_LIST",
    description:
      "Update a list's name, position, or archive status. Requires user approval before it runs.",
    parameters: z.object({ idList: z.string().describe("List ID") }).passthrough(),
    preview: (a) => ({
      title: "Update list",
      preview: `Update list ${String(a["idList"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "TRELLO_UPDATE_BOARDS_BY_ID_BOARD",
    description:
      "Update a board's name, description, or preferences. Requires user approval before it runs.",
    parameters: z.object({ idBoard: z.string().describe("Board ID") }).passthrough(),
    preview: (a) => ({
      title: "Update board",
      preview: `Update board ${String(a["idBoard"] ?? "")}`,
      confirmText: "Update",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "TRELLO_DELETE_CARDS_BY_ID_CARD",
    description: "Permanently delete a card. This cannot be undone.",
    parameters: z.object({ idCard: z.string().describe("Card ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete card",
      preview: `Delete card ${String(a["idCard"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "TRELLO_DELETE_CHECKLISTS_BY_ID_CHECKLIST",
    description: "Permanently delete a checklist and its items. This cannot be undone.",
    parameters: z.object({ idChecklist: z.string().describe("Checklist ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete checklist",
      preview: `Delete checklist ${String(a["idChecklist"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "TRELLO_DELETE_LABELS_BY_ID_LABEL",
    description: "Permanently delete a label from a board. This cannot be undone.",
    parameters: z.object({ idLabel: z.string().describe("Label ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete label",
      preview: `Delete label ${String(a["idLabel"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioTrelloDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "trello",
    name: "Trello",
    category: "productivity",
    icon: "trello",
    description: "Trello — manage boards, lists, cards, checklists, and labels (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: TRELLO_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_TRELLO_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Trello auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_TRELLO_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=trello to route Trello through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_TRELLO_AUTH_CONFIG_ID",
          label: "Composio Trello auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/trello",
    },
    tools: createComposioTools({
      provider: "trello",
      toolkit: TRELLO_TOOLKIT,
      specs: trelloComposioSpecs,
      executor,
    }),
  }
}
