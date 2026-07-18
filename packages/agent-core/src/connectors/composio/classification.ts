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
  github: {
    // Reads — pass straight through.
    GITHUB_LIST_ISSUES: "read",
    GITHUB_GET_ISSUE: "read",
    GITHUB_LIST_PULL_REQUESTS: "read",
    GITHUB_GET_PULL_REQUEST: "read",
    GITHUB_LIST_REPOSITORIES: "read",
    GITHUB_GET_REPOSITORY: "read",
    GITHUB_LIST_BRANCHES: "read",
    GITHUB_LIST_COMMITS: "read",
    GITHUB_GET_FILE_CONTENTS: "read",
    GITHUB_LIST_WORKFLOWS: "read",
    GITHUB_GET_WORKFLOW: "read",
    GITHUB_LIST_WORKFLOW_RUNS: "read",
    GITHUB_LIST_NOTIFICATIONS: "read",
    GITHUB_SEARCH_CODE: "read",
    GITHUB_SEARCH_ISSUES: "read",
    GITHUB_GET_COMMIT: "read",

    // Writes — gated for approval.
    GITHUB_CREATE_ISSUE: "write",
    GITHUB_UPDATE_ISSUE: "write",
    GITHUB_COMMENT_ON_ISSUE: "write",
    GITHUB_CREATE_PULL_REQUEST: "write",
    GITHUB_UPDATE_PULL_REQUEST: "write",
    GITHUB_SUBMIT_PULL_REQUEST_REVIEW: "write",
    GITHUB_ADD_LABELS_TO_ISSUE: "write",
    GITHUB_CREATE_BRANCH: "write",
    GITHUB_CREATE_OR_UPDATE_FILE: "write",
    GITHUB_CREATE_REPOSITORY: "write",
    GITHUB_MARK_NOTIFICATION_READ: "write",
    GITHUB_CREATE_WORKFLOW_DISPATCH: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GITHUB_MERGE_PULL_REQUEST: "irreversible",
  },
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
  notion: {
    // Reads — pass straight through.
    NOTION_SEARCH_NOTION_PAGE: "read",
    NOTION_RETRIEVE_PAGE: "read",
    NOTION_FETCH_BLOCK_CONTENTS: "read",
    NOTION_FETCH_DATABASE: "read",
    NOTION_QUERY_DATABASE: "read",
    NOTION_QUERY_DATABASE_WITH_FILTER: "read",
    NOTION_LIST_USERS: "read",
    NOTION_FETCH_COMMENTS: "read",
    NOTION_LIST_FILE_UPLOADS: "read",
    NOTION_LIST_DATA_SOURCE_TEMPLATES: "read",

    // Writes — gated for approval.
    NOTION_CREATE_NOTION_PAGE: "write",
    NOTION_UPDATE_PAGE: "write",
    NOTION_DUPLICATE_PAGE: "write",
    NOTION_ADD_MULTIPLE_PAGE_CONTENT: "write",
    NOTION_APPEND_TEXT_BLOCKS: "write",
    NOTION_REPLACE_PAGE_CONTENT: "write",
    NOTION_INSERT_ROW_DATABASE: "write",
    NOTION_UPDATE_ROW_DATABASE: "write",
    NOTION_CREATE_DATABASE: "write",
    NOTION_UPDATE_SCHEMA_DATABASE: "write",
    NOTION_CREATE_COMMENT: "write",

    // Irreversible — gated, flagged as unrecoverable.
    NOTION_ARCHIVE_NOTION_PAGE: "irreversible",
    NOTION_DELETE_BLOCK: "irreversible",
  },
  gmail: {
    // Reads — pass straight through.
    GMAIL_SEARCH_GMAIL: "read",
    GMAIL_GET_MAIL: "read",
    GMAIL_GET_THREAD: "read",
    GMAIL_LIST_LABELS: "read",
    GMAIL_LIST_DRAFTS: "read",
    GMAIL_GET_ATTACHMENT: "read",

    // Writes — gated for approval.
    GMAIL_MARK_AS_READ: "write",
    GMAIL_MARK_AS_UNREAD: "write",
    GMAIL_ARCHIVE_EMAIL: "write",
    GMAIL_TRASH_EMAIL: "write",
    GMAIL_CREATE_LABEL: "write",
    GMAIL_MODIFY_LABELS: "write",
    GMAIL_CREATE_DRAFT: "write",

    // Sends — gated, flagged as sending.
    GMAIL_SEND_EMAIL: "send",
    GMAIL_REPLY_TO_EMAIL: "send",
    GMAIL_SEND_DRAFT: "send",

    // Irreversible — gated, flagged as unrecoverable.
    GMAIL_DELETE_EMAIL: "irreversible",
  },
  googlecalendar: {
    // Reads — pass straight through.
    GOOGLECALENDAR_LIST_EVENTS: "read",
    GOOGLECALENDAR_GET_EVENT: "read",
    GOOGLECALENDAR_LIST_CALENDARS: "read",
    GOOGLECALENDAR_GET_FREE_BUSY: "read",

    // Writes — gated for approval.
    GOOGLECALENDAR_CREATE_EVENT: "write",
    GOOGLECALENDAR_QUICK_ADD_EVENT: "write",
    GOOGLECALENDAR_UPDATE_EVENT: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLECALENDAR_DELETE_EVENT: "irreversible",
  },
  googledrive: {
    // Reads — pass straight through.
    GOOGLEDRIVE_SEARCH_FILES: "read",
    GOOGLEDRIVE_LIST_FILES: "read",
    GOOGLEDRIVE_GET_FILE: "read",
    GOOGLEDRIVE_READ_FILE: "read",
    GOOGLEDRIVE_DOWNLOAD_FILE: "read",
    GOOGLEDRIVE_GET_STORAGE_QUOTA: "read",

    // Writes — gated for approval.
    GOOGLEDRIVE_CREATE_FILE: "write",
    GOOGLEDRIVE_UPLOAD_FILE: "write",
    GOOGLEDRIVE_UPDATE_FILE: "write",
    GOOGLEDRIVE_COPY_FILE: "write",
    GOOGLEDRIVE_SHARE_FILE: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLEDRIVE_DELETE_FILE: "irreversible",
  },
  googleclassroom: {
    // Reads — pass straight through.
    GOOGLECLASSROOM_LIST_COURSES: "read",
    GOOGLECLASSROOM_LIST_ASSIGNMENTS: "read",
    GOOGLECLASSROOM_GET_ASSIGNMENT: "read",
    GOOGLECLASSROOM_LIST_ANNOUNCEMENTS: "read",
    GOOGLECLASSROOM_GET_SUBMISSION: "read",

    // Writes — gated for approval.
    GOOGLECLASSROOM_TURN_IN: "write",
    GOOGLECLASSROOM_ATTACH_FILE: "write",
  },
  googletasks: {
    // Reads — pass straight through.
    GOOGLETASKS_LIST_TASK_LISTS: "read",
    GOOGLETASKS_LIST_TASKS: "read",
    GOOGLETASKS_GET_TASK: "read",

    // Writes — gated for approval.
    GOOGLETASKS_CREATE_TASK: "write",
    GOOGLETASKS_UPDATE_TASK: "write",
    GOOGLETASKS_COMPLETE_TASK: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLETASKS_DELETE_TASK: "irreversible",
  },
  googlecontacts: {
    // Reads — pass straight through.
    GOOGLECONTACTS_SEARCH_CONTACTS: "read",
    GOOGLECONTACTS_LIST_CONTACTS: "read",
    GOOGLECONTACTS_GET_CONTACT: "read",

    // Writes — gated for approval.
    GOOGLECONTACTS_CREATE_CONTACT: "write",
    GOOGLECONTACTS_UPDATE_CONTACT: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLECONTACTS_DELETE_CONTACT: "irreversible",
  },
  googlemeet: {
    // Reads — pass straight through.
    GOOGLEMEET_GET_SPACE: "read",
    GOOGLEMEET_LIST_CONFERENCE_RECORDS: "read",
    GOOGLEMEET_GET_CONFERENCE_RECORD: "read",
    GOOGLEMEET_GET_TRANSCRIPT: "read",

    // Writes — gated for approval.
    GOOGLEMEET_CREATE_SPACE: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLEMEET_END_ACTIVE_CONFERENCE: "irreversible",
  },
  slack: {
    // Reads — pass straight through.
    SLACK_LIST_CONVERSATIONS: "read",
    SLACK_SEARCH_MESSAGES: "read",
    SLACK_LIST_ALL_USERS: "read",
    SLACK_FETCH_CONVERSATION_HISTORY: "read",
    SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION: "read",
    SLACK_RETRIEVE_DETAILED_USER_INFORMATION: "read",
    SLACK_FIND_USERS: "read",
    SLACK_LIST_ALL_CHANNELS: "read",
    SLACK_LIST_WORKSPACE_USERS: "read",
    SLACK_LIST_UNREAD_CHANNEL_MESSAGES: "read",
    SLACK_LIST_PINNED_ITEMS: "read",
    SLACK_LIST_REMINDERS: "read",
    SLACK_LIST_USER_GROUPS: "read",
    SLACK_GET_REMINDER: "read",
    SLACK_GET_BOT_USER: "read",
    SLACK_FIND_USER_BY_EMAIL_ADDRESS: "read",
    SLACK_GET_APP_PERMISSION_SCOPES: "read",
    SLACK_API_TEST: "read",

    // Writes — gated for approval.
    SLACK_SEND_MESSAGE: "write",
    SLACK_SEND_EPHEMERAL_MESSAGE: "write",
    SLACK_SEND_ME_MESSAGE: "write",
    SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK: "write",
    SLACK_CREATE_CHANNEL: "write",
    SLACK_CREATE_REMINDER: "write",
    SLACK_ADD_REACTION_TO_AN_ITEM: "write",
    SLACK_ADD_STAR: "write",
    SLACK_CUSTOMIZE_URL_UNFURL: "write",
    SLACK_OPEN_DM: "write",
    SLACK_CLOSE_DM: "write",
    SLACK_CREATE_USER_GROUP: "write",
    SLACK_CREATE_SLACK_LIST: "write",
    SLACK_CREATE_SLACK_LIST_ITEM: "write",
    SLACK_ADD_REMOTE_FILE: "write",

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

// Classify one action. Unknown toolkit or unknown slug → `write` (default-deny).
export function classifyAction(toolkit: string, slug: string): ActionRisk {
  return COMPOSIO_RISK_MAP[toolkit.toLowerCase()]?.[slug] ?? "write"
}

// True only when the action is an explicitly-classified read.
export function isReadAction(toolkit: string, slug: string): boolean {
  return classifyAction(toolkit, slug) === "read"
}
