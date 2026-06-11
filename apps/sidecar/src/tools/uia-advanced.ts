import { tool, jsonSchema } from "ai"
import type { UiaElement } from "@yomi/shared"
import { uia } from "../uia/client.js"
import { blockedGuard, actFailed, guardedAct } from "./act-helpers.js"

// After a mutation action succeeds, re-snapshot automatically so the agent sees the new state
// without an extra round-trip. Returns the action result merged with `tree`.
async function actAndSnapshot(
  action: { kind: string; ref: string },
  run: (ref: string) => Promise<unknown>,
) {
  const result = await guardedAct(action, run)
  if (!actFailed(result)) {
    const tree = await uia.getUiTree().catch(() => null)
    if (tree) return { ...(result as object), tree }
  }
  return result
}

export function createUiaAdvancedTools() {
  return {
    expand_element: tool({
      description:
        "Expand a collapsed tree node, dropdown, or accordion section by its `ref` " +
        "(uses ExpandCollapse UIA pattern). Automatically re-snapshots afterward — " +
        "the response includes a `tree` field with the updated UI tree.",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref from get_ui_tree" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) =>
        actAndSnapshot({ kind: "expand", ref }, (r) => uia.expandElement(r).catch((e) => ({ ok: false, error: e.message }))),
    }),

    collapse_element: tool({
      description:
        "Collapse an expanded tree node or section by its `ref`. " +
        "Uses the ExpandCollapse UIA pattern. Automatically re-snapshots afterward — " +
        "the response includes a `tree` field with the updated UI tree.",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref from get_ui_tree" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) =>
        actAndSnapshot({ kind: "collapse", ref }, (r) => uia.collapseElement(r).catch((e) => ({ ok: false, error: e.message }))),
    }),

    scroll_element: tool({
      description:
        "Scroll a scrollable container (list, tree, pane) by setting its scroll position as a " +
        "percentage (0–100). Pass -1 to leave an axis unchanged. Uses the Scroll UIA pattern. " +
        "Automatically re-snapshots afterward — the response includes a `tree` field.",
      parameters: jsonSchema<{ ref: string; horizontalPercent?: number; verticalPercent?: number }>({
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref from get_ui_tree" },
          horizontalPercent: {
            type: "number",
            description: "Horizontal scroll position 0–100, or -1 for no change",
          },
          verticalPercent: {
            type: "number",
            description: "Vertical scroll position 0–100, or -1 for no change",
          },
        },
        required: ["ref"],
      }),
      execute: async ({ ref, horizontalPercent, verticalPercent }) =>
        actAndSnapshot({ kind: "scroll", ref }, (r) =>
          uia.scroll(r, horizontalPercent, verticalPercent).catch((e) => ({ ok: false, error: e.message })),
        ),
    }),

    right_click: tool({
      description:
        "Right-click at the center of an element to open its context menu. " +
        "Automatically re-snapshots afterward — the response includes a `tree` field " +
        "so you can see the context menu that appeared.",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref from get_ui_tree" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) =>
        actAndSnapshot({ kind: "right_click", ref }, (r) => uia.rightClick(r).catch((e) => ({ ok: false, error: e.message }))),
    }),

    get_subtree: tool({
      description:
        "Walk the UI Automation subtree under a specific element (not the whole window). " +
        "Use this to explore deeply nested UI like tree views, list boxes, or containers that were " +
        "truncated by the top-level snapshot's node/depth limit.",
      parameters: jsonSchema<{ ref: string; maxNodes?: number; maxDepth?: number }>({
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref from get_ui_tree" },
          maxNodes: { type: "number", description: "Max nodes to return (default 400)" },
          maxDepth: { type: "number", description: "Max recursion depth (default 40)" },
        },
        required: ["ref"],
      }),
      execute: async ({ ref, maxNodes, maxDepth }) => {
        const blocked = blockedGuard()
        if (blocked) return blocked
        return uia.getSubtree(ref, maxNodes, maxDepth).catch((e) => ({ error: e.message }))
      },
    }),

    find_element: tool({
      description:
        "Search descendants of a UI element by role, name, and/or automationId. " +
        "Use this to programmatically locate controls by properties instead of walking the tree. " +
        "Returns the first matching element with a stable ref for further actions.",
      parameters: jsonSchema<{ ref: string; role?: string; name?: string; automationId?: string }>({
        type: "object",
        properties: {
          ref: { type: "string", description: "Parent element ref from get_ui_tree" },
          role: { type: "string", description: "Control type / role to match (e.g. Button, TreeItem, Edit)" },
          name: { type: "string", description: "Element name/accessible name to match" },
          automationId: { type: "string", description: "Automation ID to match" },
        },
        required: ["ref"],
      }),
      execute: async ({ ref, role, name, automationId }) => {
        const blocked = blockedGuard()
        if (blocked) return blocked
        return uia.findElement(ref, role, name, automationId).catch((e) => ({ error: e.message }))
      },
    }),

    get_text: tool({
      description:
        "Read the full text content of an element that supports the Text UIA pattern. " +
        "Use this on editors, terminals, documents, and other rich text controls to read their contents.",
      parameters: jsonSchema<{ ref: string }>({
        type: "object",
        properties: { ref: { type: "string", description: "Element ref from get_ui_tree" } },
        required: ["ref"],
      }),
      execute: async ({ ref }) => {
        const blocked = blockedGuard()
        if (blocked) return blocked
        return uia.getText(ref).catch((e) => ({ error: e.message }))
      },
    }),

    get_children: tool({
      description:
        "Fetch the direct children of a UI element (depth 1 only). " +
        "Lighter than get_subtree when you just need to see what's inside a container. " +
        "Each child includes a childCount so you know which ones are expandable.",
      parameters: jsonSchema<{ ref: string; maxChildren?: number }>({
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref from get_ui_tree" },
          maxChildren: { type: "number", description: "Max children to return (default 400)" },
        },
        required: ["ref"],
      }),
      execute: async ({ ref, maxChildren }) => {
        const blocked = blockedGuard()
        if (blocked) return blocked
        return uia.getChildren(ref, maxChildren).catch((e) => ({ error: e.message }))
      },
    }),

    get_focus_tree: tool({
      description:
        "Return the currently focused element and its ancestor chain up to the window. " +
        "Use this to understand what's active without doing a full get_ui_tree. " +
        "The response includes focusRef (the focused element's ref) for follow-up actions.",
      parameters: jsonSchema<{ maxDepth?: number }>({
        type: "object",
        properties: {
          maxDepth: { type: "number", description: "Maximum ancestor depth from focused element (default 10)" },
        },
      }),
      execute: async ({ maxDepth }) => {
        return uia.getFocusTree(maxDepth).catch((e) => ({ error: e.message }))
      },
    }),
  }
}
