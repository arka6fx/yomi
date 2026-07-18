// Composio risk-classification map — plain data, the one piece of ongoing upkeep.
// Composio has many actions per toolkit with no universal read/write flag, so this
// curated list decides which action slugs may run straight through (read) and which
// must be gated for user approval (write/send/paid/irreversible).
//
// DEFAULT-DENY: any slug not present here is treated as a `write` and gated. That
// keeps an unclassified — possibly destructive — action from ever auto-running.
// Adding or reclassifying an action is a one-line, testable change.

// Risk of a connector action. `read` runs straight through; every other value is a
// gateWrite risk that routes the action through the approval flow.
export type ActionRisk = "read" | "write" | "send" | "paid" | "irreversible"

// The gate-worthy subset (everything that isn't a read).
export type WriteRisk = Exclude<ActionRisk, "read">

// toolkit (lowercase) → action slug → risk. Slugs are Composio's identifiers
// (e.g. `LINEAR_CREATE_LINEAR_ISSUE`).
export const COMPOSIO_RISK_MAP: Record<string, Record<string, ActionRisk>> = {
  linear: {
    // Reads — pass straight through.
    LINEAR_LIST_LINEAR_ISSUES: "read",
    LINEAR_LIST_ISSUES: "read",
    LINEAR_LIST_ISSUES_BY_TEAM_ID: "read",
    LINEAR_GET_LINEAR_ISSUE: "read",
    LINEAR_LIST_LINEAR_TEAMS: "read",
    LINEAR_GET_ALL_LINEAR_TEAMS: "read",
    LINEAR_LIST_LINEAR_PROJECTS: "read",
    LINEAR_GET_LINEAR_PROJECT: "read",
    LINEAR_LIST_LINEAR_LABELS: "read",
    LINEAR_LIST_LINEAR_STATES: "read",
    LINEAR_LIST_LINEAR_CYCLES: "read",
    LINEAR_GET_CYCLES_BY_TEAM_ID: "read",
    LINEAR_LIST_LINEAR_USERS: "read",
    LINEAR_GET_CURRENT_USER: "read",
    LINEAR_LIST_COMMENTS: "read",
    LINEAR_GET_COMMENT: "read",
    // Runs arbitrary GraphQL — including mutations (create/update/delete). Must be
    // gated; classifying it read would be an approval bypass.
    LINEAR_RUN_QUERY_OR_MUTATION: "write",

    // Writes — gated for approval.
    LINEAR_CREATE_LINEAR_ISSUE: "write",
    LINEAR_CREATE_ISSUE: "write",
    LINEAR_UPDATE_ISSUE: "write",
    LINEAR_CREATE_LINEAR_COMMENT: "write",
    LINEAR_CREATE_LINEAR_LABEL: "write",
    LINEAR_CREATE_LINEAR_PROJECT: "write",
    LINEAR_CREATE_TEAM: "write",
    LINEAR_REMOVE_ISSUE_LABEL: "write",
    LINEAR_ARCHIVE_ISSUE: "write",
    LINEAR_ARCHIVE_PROJECT: "write",

    // Irreversible — gated, and flagged as unrecoverable.
    LINEAR_DELETE_LINEAR_ISSUE: "irreversible",
  },
}

// Classify one action. Unknown toolkit or unknown slug → `write` (default-deny).
export function classifyAction(toolkit: string, slug: string): ActionRisk {
  return COMPOSIO_RISK_MAP[toolkit.toLowerCase()]?.[slug] ?? "write"
}

// True only when the action is an explicitly-classified read.
export function isReadAction(toolkit: string, slug: string): boolean {
  return classifyAction(toolkit, slug) === "read"
}
