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
    GITHUB_LIST_REPOSITORY_ISSUES: "read",
    GITHUB_GET_AN_ISSUE: "read",
    GITHUB_FIND_PULL_REQUESTS: "read",
    GITHUB_GET_A_PULL_REQUEST: "read",
    GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER: "read",
    GITHUB_GET_A_REPOSITORY: "read",
    GITHUB_LIST_BRANCHES: "read",
    GITHUB_LIST_COMMITS: "read",
    GITHUB_GET_REPOSITORY_CONTENT: "read",
    GITHUB_LIST_REPOSITORY_WORKFLOWS: "read",
    GITHUB_GET_A_WORKFLOW: "read",
    GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY: "read",
    GITHUB_LIST_NOTIFICATIONS_FOR_THE_AUTHENTICATED_USER: "read",
    GITHUB_SEARCH_CODE: "read",
    GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS: "read",
    GITHUB_GET_A_COMMIT: "read",

    // Writes — gated for approval.
    GITHUB_CREATE_AN_ISSUE: "write",
    GITHUB_UPDATE_AN_ISSUE: "write",
    GITHUB_CREATE_AN_ISSUE_COMMENT: "write",
    GITHUB_CREATE_A_PULL_REQUEST: "write",
    GITHUB_UPDATE_A_PULL_REQUEST: "write",
    GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST: "write",
    GITHUB_ADD_LABELS_TO_AN_ISSUE: "write",
    GITHUB_CREATE_A_REFERENCE: "write",
    GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS: "write",
    GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER: "write",
    GITHUB_MARK_A_THREAD_AS_READ: "write",
    GITHUB_CREATE_A_WORKFLOW_DISPATCH_EVENT: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GITHUB_MERGE_A_PULL_REQUEST: "irreversible",
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
    NOTION_FETCH_DATA: "read",
    NOTION_FETCH_BLOCK_CONTENTS: "read",
    NOTION_FETCH_DATABASE: "read",
    NOTION_QUERY_DATABASE: "read",
    NOTION_LIST_USERS: "read",
    NOTION_FETCH_COMMENTS: "read",

    // Writes — gated for approval. NOTION_ARCHIVE_NOTION_PAGE and
    // NOTION_DELETE_BLOCK are soft-deletes (Composio's own description calls
    // DELETE_BLOCK "deleted (archived)") — recoverable from trash, so neither
    // is "irreversible". This toolkit has no genuinely unrecoverable action.
    NOTION_CREATE_NOTION_PAGE: "write",
    NOTION_ADD_MULTIPLE_PAGE_CONTENT: "write",
    NOTION_UPDATE_PAGE: "write",
    NOTION_ARCHIVE_NOTION_PAGE: "write",
    NOTION_DUPLICATE_PAGE: "write",
    NOTION_DELETE_BLOCK: "write",
    NOTION_INSERT_ROW_DATABASE: "write",
    NOTION_UPDATE_ROW_DATABASE: "write",
    NOTION_CREATE_DATABASE: "write",
    NOTION_UPDATE_SCHEMA_DATABASE: "write",
    NOTION_CREATE_COMMENT: "write",
  },
  gmail: {
    // Reads — pass straight through.
    GMAIL_FETCH_EMAILS: "read",
    GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: "read",
    GMAIL_FETCH_MESSAGE_BY_THREAD_ID: "read",
    GMAIL_LIST_LABELS: "read",
    GMAIL_LIST_DRAFTS: "read",
    GMAIL_GET_ATTACHMENT: "read",

    // Writes — gated for approval.
    GMAIL_ADD_LABEL_TO_EMAIL: "write",
    GMAIL_MOVE_TO_TRASH: "write",
    GMAIL_CREATE_LABEL: "write",
    GMAIL_CREATE_EMAIL_DRAFT: "write",

    // Sends — gated, flagged as sending.
    GMAIL_SEND_EMAIL: "send",
    GMAIL_REPLY_TO_THREAD: "send",
    GMAIL_SEND_DRAFT: "send",

    // Irreversible — gated, flagged as unrecoverable.
    GMAIL_DELETE_MESSAGE: "irreversible",
  },
  googlecalendar: {
    // Reads — pass straight through.
    GOOGLECALENDAR_EVENTS_LIST: "read",
    GOOGLECALENDAR_FIND_EVENT: "read",
    GOOGLECALENDAR_LIST_CALENDARS: "read",
    GOOGLECALENDAR_FREE_BUSY_QUERY: "read",

    // Writes — gated for approval.
    GOOGLECALENDAR_CREATE_EVENT: "write",
    GOOGLECALENDAR_QUICK_ADD: "write",
    GOOGLECALENDAR_UPDATE_EVENT: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLECALENDAR_DELETE_EVENT: "irreversible",
  },
  googledrive: {
    // Reads — pass straight through.
    GOOGLEDRIVE_FIND_FILE: "read",
    GOOGLEDRIVE_LIST_FILES: "read",
    GOOGLEDRIVE_GET_FILE_METADATA: "read",
    GOOGLEDRIVE_PARSE_FILE: "read",
    GOOGLEDRIVE_DOWNLOAD_FILE: "read",
    GOOGLEDRIVE_GET_ABOUT: "read",

    // Writes — gated for approval.
    GOOGLEDRIVE_CREATE_FILE_FROM_TEXT: "write",
    GOOGLEDRIVE_UPDATE_FILE_PUT: "write",
    GOOGLEDRIVE_COPY_FILE: "write",
    GOOGLEDRIVE_ADD_FILE_SHARING_PREFERENCE: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLEDRIVE_GOOGLE_DRIVE_DELETE_FOLDER_OR_FILE_ACTION: "irreversible",
  },
  googledocs: {
    // Reads — pass straight through. The chart actions are cross-connector
    // reads against a Google Sheet, not writes to the Doc.
    GOOGLEDOCS_GET_DOCUMENT_BY_ID: "read",
    GOOGLEDOCS_SEARCH_DOCUMENTS: "read",
    GOOGLEDOCS_LIST_SPREADSHEET_CHARTS_ACTION: "read",
    GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET: "read",

    // Writes — gated for approval. Docs edits are recoverable via the
    // document's built-in version history, so nothing here is "irreversible".
    GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN: "write",
    GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN: "write",
    GOOGLEDOCS_INSERT_TEXT_ACTION: "write",
    GOOGLEDOCS_REPLACE_ALL_TEXT: "write",
    GOOGLEDOCS_CREATE_PARAGRAPH_BULLETS: "write",
    GOOGLEDOCS_INSERT_TABLE_ACTION: "write",
    GOOGLEDOCS_INSERT_INLINE_IMAGE: "write",
    GOOGLEDOCS_COPY_DOCUMENT: "write",
  },
  googlesheets: {
    // Reads — pass straight through.
    GOOGLESHEETS_GET_SPREADSHEET_INFO: "read",
    GOOGLESHEETS_BATCH_GET: "read",
    GOOGLESHEETS_SEARCH_SPREADSHEETS: "read",
    GOOGLESHEETS_GET_SHEET_NAMES: "read",
    GOOGLESHEETS_QUERY_TABLE: "read",
    GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW: "read",

    // Writes — gated for approval.
    GOOGLESHEETS_CREATE_GOOGLE_SHEET1: "write",
    GOOGLESHEETS_ADD_SHEET: "write",
    GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND: "write",
    GOOGLESHEETS_FORMAT_CELL: "write",
    GOOGLESHEETS_CREATE_CHART: "write",
    GOOGLESHEETS_CLEAR_VALUES: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLESHEETS_DELETE_SHEET: "irreversible",
  },
  googleslides: {
    // Reads — pass straight through.
    GOOGLESLIDES_PRESENTATIONS_GET: "read",
    GOOGLESLIDES_PRESENTATIONS_PAGES_GET: "read",
    GOOGLESLIDES_PRESENTATIONS_PAGES_GET_THUMBNAIL: "read",

    // Writes — gated for approval.
    GOOGLESLIDES_CREATE_SLIDES_MARKDOWN: "write",
    GOOGLESLIDES_PRESENTATIONS_CREATE: "write",
    GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE: "write",
  },
  // Composio's toolkit slug is "google_classroom" (underscore) — the def id and
  // classification-map key must match it exactly, or every action here falls
  // through to the read-map's implicit default-deny (classified as "write").
  google_classroom: {
    // Reads — pass straight through. Composio's Classroom toolkit has no
    // submit/turn-in or attach-file action, so every surfaced tool is read-only.
    GOOGLE_CLASSROOM_COURSES_LIST: "read",
    GOOGLE_CLASSROOM_COURSE_WORK_LIST: "read",
    GOOGLE_CLASSROOM_COURSE_WORK_GET: "read",
    GOOGLE_CLASSROOM_COURSES_ANNOUNCEMENTS_LIST: "read",
    GOOGLE_CLASSROOM_COURSE_WORK_STUDENT_SUBMISSIONS_LIST: "read",
  },
  googletasks: {
    // Reads — pass straight through.
    GOOGLETASKS_LIST_TASK_LISTS: "read",
    GOOGLETASKS_LIST_TASKS: "read",
    GOOGLETASKS_GET_TASK: "read",

    // Writes — gated for approval.
    GOOGLETASKS_INSERT_TASK: "write",
    GOOGLETASKS_PATCH_TASK: "write",

    // Irreversible — gated, flagged as unrecoverable.
    GOOGLETASKS_DELETE_TASK: "irreversible",
  },
  googlemeet: {
    // Reads — pass straight through.
    GOOGLEMEET_GET_MEET: "read",
    GOOGLEMEET_LIST_CONFERENCE_RECORDS: "read",
    GOOGLEMEET_GET_CONFERENCE_RECORD_FOR_MEET: "read",
    GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID: "read",
    GOOGLEMEET_GET_RECORDINGS_BY_CONFERENCE_RECORD_ID: "read",
    GOOGLEMEET_LIST_PARTICIPANT_SESSIONS: "read",
    GOOGLEMEET_GET_PARTICIPANT_SESSION: "read",

    // Writes — gated for approval. This toolkit has no "end active conference"
    // or delete action, so there is no irreversible bucket.
    GOOGLEMEET_CREATE_MEET: "write",
    GOOGLEMEET_UPDATE_SPACE: "write",
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
  // Composio's toolkit slug is "google_maps" (underscore) — must match exactly,
  // same footgun as google_classroom above: a mismatch falls through to
  // default-deny (every action classified "write").
  google_maps: {
    // Reads — pass straight through. Only 2 tools are wired up for this toolkit
    // (see google-maps.ts for why GEOCODING_API/GET_DIRECTION are excluded) —
    // both are read-only searches, so this toolkit has no write actions at all.
    GOOGLE_MAPS_NEARBY_SEARCH: "read",
    GOOGLE_MAPS_TEXT_SEARCH: "read",
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
