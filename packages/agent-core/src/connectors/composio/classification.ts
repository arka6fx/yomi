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
  discord: {
    // Reads — pass straight through.
    DISCORD_GET_MY_USER: "read",
    DISCORD_LIST_MY_GUILDS: "read",
    DISCORD_GET_MY_GUILD_MEMBER: "read",
    DISCORD_INVITE_RESOLVE: "read",
    DISCORD_LIST_MY_CONNECTIONS: "read",
    DISCORD_GET_USER: "read",
    DISCORD_GET_GUILD_WIDGET: "read",
    DISCORD_LIST_STICKER_PACKS: "read",
    DISCORD_GET_GATEWAY: "read",
    DISCORD_GET_OPENID_CONNECT_USERINFO: "read",
    DISCORD_GET_MY_OAUTH2_AUTHORIZATION: "read",
    DISCORD_GET_PUBLIC_KEYS: "read",
    DISCORD_GET_GUILD_TEMPLATE: "read",
    DISCORD_GET_INVITE: "read",

    // Writes — gated for approval.
    DISCORD_MODIFY_CURRENT_USER: "write",
    DISCORD_LEAVE_GUILD: "write",

    // Irreversible — gated, flagged as unrecoverable.
    DISCORD_DELETE_TEST_ENTITLEMENT: "irreversible",
  },
  firecrawl: {
    // Reads — pass straight through (Firecrawl is primarily read/search).
    FIRECRAWL_SEARCH: "read",
    FIRECRAWL_SCRAPE: "read",
    FIRECRAWL_MAP_MULTIPLE_URLS_BASED_ON_OPTIONS: "read",
    FIRECRAWL_DEEP_RESEARCH: "read",
    FIRECRAWL_EXTRACT: "read",
    FIRECRAWL_GET_DEEP_RESEARCH_STATUS: "read",
    FIRECRAWL_EXTRACT_GET: "read",
    FIRECRAWL_GET_THE_STATUS_OF_A_CRAWL_JOB: "read",
    FIRECRAWL_CRAWL_GET: "read",
    FIRECRAWL_CRAWL_LIST_ACTIVE: "read",
    FIRECRAWL_CREDIT_USAGE_GET: "read",
    FIRECRAWL_TOKEN_USAGE_GET: "read",
    FIRECRAWL_QUEUE_GET: "read",
    FIRECRAWL_BATCH_SCRAPE_GET: "read",
    FIRECRAWL_GET_AGENT_STATUS: "read",

    // Writes — gated for approval.
    FIRECRAWL_CRAWL: "write",
    FIRECRAWL_CRAWL_V2: "write",
    FIRECRAWL_START_AGENT: "write",
    FIRECRAWL_BATCH_SCRAPE: "write",
    FIRECRAWL_AGENT_CANCEL: "write",
    FIRECRAWL_CRAWL_CANCEL: "write",
    FIRECRAWL_CRAWL_DELETE: "write",
    FIRECRAWL_BATCH_SCRAPE_CANCEL: "write",
    FIRECRAWL_LLMS_TXT_GENERATE: "write",
  },
  hubspot: {
    // Reads — pass straight through.
    HUBSPOT_LIST_CONTACTS: "read",
    HUBSPOT_LIST_DEALS: "read",
    HUBSPOT_BATCH_READ_COMPANIES_BY_PROPERTIES: "read",
    HUBSPOT_SEARCH_DEALS: "read",
    HUBSPOT_SEARCH_TICKETS: "read",
    HUBSPOT_SEARCH_PRODUCTS: "read",
    HUBSPOT_SEARCH_CAMPAIGNS: "read",
    HUBSPOT_LIST_PRODUCTS: "read",
    HUBSPOT_LIST_FEEDBACK_SUBMISSIONS: "read",
    HUBSPOT_LIST_CONTACT_TASKS: "read",
    HUBSPOT_LIST_EMAILS: "read",
    HUBSPOT_LIST_OBJECT_ASSOCIATIONS: "read",
    HUBSPOT_LIST_EVENT_TEMPLATES: "read",
    HUBSPOT_AUDIT_PIPELINE_CHANGES: "read",

    // Writes — gated for approval.
    HUBSPOT_CREATE_CONTACT: "write",
    HUBSPOT_CREATE_CONTACTS: "write",
    HUBSPOT_CREATE_DEAL: "write",
    HUBSPOT_CREATE_TASK: "write",
    HUBSPOT_CREATE_COMPANY: "write",
    HUBSPOT_CREATE_COMPANIES: "write",
    HUBSPOT_CREATE_CAMPAIGN: "write",
    HUBSPOT_CREATE_WORKFLOW: "write",
    HUBSPOT_CREATE_BATCH_OF_OBJECTS: "write",
    HUBSPOT_UPDATE_PRODUCT: "write",

    // Send — gated, flagged as sending.
    HUBSPOT_CREATE_BATCH_OF_QUOTES: "send",

    // Irreversible — gated, flagged as unrecoverable.
    HUBSPOT_ARCHIVE_CONTACT: "irreversible",
    HUBSPOT_ARCHIVE_CONTACTS: "irreversible",
    HUBSPOT_ARCHIVE_DEALS: "irreversible",
    HUBSPOT_ARCHIVE_COMPANY: "irreversible",
    HUBSPOT_ARCHIVE_COMPANIES: "irreversible",
    HUBSPOT_ARCHIVE_TICKET: "irreversible",
    HUBSPOT_ARCHIVE_TICKETS: "irreversible",
    HUBSPOT_ARCHIVE_PRODUCT: "irreversible",
    HUBSPOT_ARCHIVE_PRODUCTS: "irreversible",
    HUBSPOT_ARCHIVE_CRM_OBJECT_BY_ID: "irreversible",
  },
  outlook: {
    // Reads — pass straight through.
    OUTLOOK_GET_MY_INFO: "read",
    OUTLOOK_LIST_MAIL_FOLDERS: "read",
    OUTLOOK_LIST_MESSAGES: "read",
    OUTLOOK_GET_MESSAGE: "read",
    OUTLOOK_SEARCH_MESSAGES: "read",
    OUTLOOK_LIST_CALENDARS: "read",
    OUTLOOK_LIST_CALENDAR_EVENTS: "read",
    OUTLOOK_GET_CALENDAR_EVENT: "read",
    OUTLOOK_LIST_CONTACTS: "read",
    OUTLOOK_GET_CONTACT: "read",

    // Sends — gated, flagged as sending.
    OUTLOOK_SEND_MAIL: "send",

    // Writes — gated for approval.
    OUTLOOK_CREATE_DRAFT: "write",
    OUTLOOK_CREATE_DRAFT_REPLY: "write",
    OUTLOOK_CALENDAR_CREATE_EVENT: "write",
    OUTLOOK_ACCEPT_EVENT: "write",
    OUTLOOK_CREATE_CONTACT: "write",
    OUTLOOK_CREATE_MAIL_FOLDER: "write",

    // Irreversible — gated, flagged as unrecoverable.
    OUTLOOK_DELETE_MESSAGE: "irreversible",
    OUTLOOK_DELETE_CALENDAR_EVENT: "irreversible",
  },
  linkedin: {
    // Reads — pass straight through.
    LINKEDIN_GET_MY_INFO: "read",
    LINKEDIN_GET_PERSON: "read",
    LINKEDIN_GET_COMPANY_INFO: "read",
    LINKEDIN_GET_POST_CONTENT: "read",
    LINKEDIN_GET_SHARE_STATS: "read",
    LINKEDIN_GET_ORG_PAGE_STATS: "read",
    LINKEDIN_GET_NETWORK_SIZE: "read",
    LINKEDIN_GET_IMAGE: "read",
    LINKEDIN_GET_IMAGES: "read",
    LINKEDIN_GET_VIDEOS: "read",
    LINKEDIN_GET_AD_TARGETING_FACETS: "read",
    LINKEDIN_GET_AUDIENCE_COUNTS: "read",
    LINKEDIN_LIST_REACTIONS: "read",
    LINKEDIN_SEARCH_AD_TARGETING_ENTITIES: "read",

    // Sends — gated, flagged as sending (public posts/comments).
    LINKEDIN_CREATE_LINKED_IN_POST: "send",
    LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE: "send",
    LINKEDIN_CREATE_COMMENT_ON_POST: "send",

    // Writes — gated for approval.
    LINKEDIN_INITIALIZE_IMAGE_UPLOAD: "write",
    LINKEDIN_REGISTER_IMAGE_UPLOAD: "write",

    // Irreversible — gated, flagged as unrecoverable.
    LINKEDIN_DELETE_LINKED_IN_POST: "irreversible",
    LINKEDIN_DELETE_POST: "irreversible",
    LINKEDIN_DELETE_UGC_POST: "irreversible",
  },
  whatsapp: {
    // Reads — pass straight through.
    WHATSAPP_GET_PHONE_NUMBERS: "read",
    WHATSAPP_GET_PHONE_NUMBER: "read",
    WHATSAPP_GET_BUSINESS_PROFILE: "read",
    WHATSAPP_GET_MESSAGE_HISTORY: "read",
    WHATSAPP_GET_MESSAGE_TEMPLATES: "read",
    WHATSAPP_GET_BUSINESS_ACCOUNT_DETAILS: "read",
    WHATSAPP_GET_MEDIA_INFO: "read",
    WHATSAPP_GET_COMMERCE_SETTINGS: "read",

    // Sends — gated, flagged as sending (messages to external users).
    WHATSAPP_SEND_MESSAGE: "send",
    WHATSAPP_SEND_TEMPLATE_MESSAGE: "send",

    // Writes — gated for approval.
    WHATSAPP_MARK_MESSAGE_AS_READ: "write",
    WHATSAPP_CREATE_QR_CODE: "write",
    WHATSAPP_UPLOAD_MEDIA: "write",

    // Irreversible — gated, flagged as unrecoverable.
    WHATSAPP_DELETE_MEDIA: "irreversible",
  },
  google_maps: {
    // Reads — pass straight through. Only 2 tools are wired up for this toolkit
    // (see google-maps.ts for why GEOCODING_API/GET_DIRECTION are excluded) —
    // both are read-only searches, so this toolkit has no write actions at all.
    GOOGLE_MAPS_NEARBY_SEARCH: "read",
    GOOGLE_MAPS_TEXT_SEARCH: "read",
  },
  todoist: {
    // Reads — pass straight through.
    TODOIST_GET_ALL_PROJECTS: "read",
    TODOIST_GET_PROJECT: "read",
    TODOIST_GET_PROJECT_FULL: "read",
    TODOIST_GET_ALL_TASKS: "read",
    TODOIST_GET_TASK2: "read",
    TODOIST_FILTER_TASKS: "read",
    TODOIST_LIST_SECTIONS: "read",
    TODOIST_GET_SECTION_V1: "read",
    TODOIST_LIST_LABELS: "read",
    TODOIST_SEARCH_LABELS: "read",
    TODOIST_GET_ALL_COMMENTS: "read",
    TODOIST_GET_COMMENT_V1: "read",
    TODOIST_LIST_COMPLETED_TASKS: "read",
    TODOIST_LIST_COMPLETED_TASKS_BY_DUE_DATE: "read",
    TODOIST_GET_COMPLETED_TASKS_BY_COMPLETION_DATE: "read",
    TODOIST_GET_USER: "read",
    TODOIST_GET_PRODUCTIVITY_STATS: "read",
    TODOIST_LIST_ACTIVITIES: "read",
    TODOIST_LIST_FILTERS: "read",
    TODOIST_GET_ID_MAPPINGS: "read",
    TODOIST_GET_BACKUPS: "read",
    TODOIST_GET_SPECIAL_BACKUPS: "read",
    TODOIST_LIST_ARCHIVED_PROJECTS: "read",
    TODOIST_LIST_ARCHIVED_SECTIONS: "read",
    TODOIST_GET_PROJECT_PERMISSIONS: "read",
    TODOIST_GET_WORKSPACE_PLAN_DETAILS: "read",
    TODOIST_LIST_PROJECT_COLLABORATORS: "read",
    TODOIST_LIST_JOINABLE_WORKSPACES: "read",
    TODOIST_LIST_ALL_INVITATIONS_WORKSPACES: "read",
    TODOIST_LIST_PENDING_WORKSPACE_INVITATIONS: "read",
    TODOIST_GET_PERSONAL_LABEL: "read",

    // Writes — gated for approval.
    TODOIST_CREATE_TASK: "write",
    TODOIST_QUICK_ADD_TASK: "write",
    TODOIST_UPDATE_TASK: "write",
    TODOIST_CLOSE_TASK_V1: "write",
    TODOIST_REOPEN_TASK2: "write",
    TODOIST_CREATE_PROJECT2: "write",
    TODOIST_UPDATE_PROJECT2: "write",
    TODOIST_ARCHIVE_PROJECT2: "write",
    TODOIST_UNARCHIVE_PROJECT: "write",
    TODOIST_CREATE_SECTION_V1: "write",
    TODOIST_UPDATE_SECTION: "write",
    TODOIST_MOVE_TASK: "write",
    TODOIST_CREATE_LABEL_V1: "write",
    TODOIST_UPDATE_LABEL_V1_SECOND: "write",
    TODOIST_CREATE_COMMENT_V1: "write",
    TODOIST_UPDATE_COMMENT2: "write",
    TODOIST_BULK_CREATE_TASKS: "write",
    TODOIST_ADD_WORKSPACE: "write",
    TODOIST_SYNC: "write",
    TODOIST_INVITE_PROJECT_COLLABORATOR: "write",
    TODOIST_REMOVE_SHARED_LABEL_V1: "write",
    TODOIST_RENAME_SHARED_LABELS_V1: "write",
    TODOIST_EXPORT_TEMPLATE_AS_FILE: "write",
    TODOIST_EXPORT_TEMPLATE_AS_URL: "write",
    TODOIST_IMPORT_TEMPLATE_INTO_PROJECT_BY_ID: "write",
    TODOIST_IMPORT_TEMPLATE_INTO_PROJECT_FROM_FILE: "write",

    // Irreversible — gated, flagged as unrecoverable.
    TODOIST_DELETE_TASK: "irreversible",
    TODOIST_DELETE_TASK_V1: "irreversible",
    TODOIST_DELETE_PROJECT2: "irreversible",
    TODOIST_DELETE_SECTION2: "irreversible",
    TODOIST_DELETE_COMMENT: "irreversible",
    TODOIST_DELETE_LABEL_V1: "irreversible",
    TODOIST_DELETE_UPLOAD: "irreversible",
  },
  jira: {
    // Reads — pass straight through.
    JIRA_GET_ALL_PROJECTS: "read",
    JIRA_GET_PROJECT: "read",
    JIRA_SEARCH_ISSUES: "read",
    JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET: "read",
    JIRA_GET_ISSUE: "read",
    JIRA_GET_ALL_STATUSES: "read",
    JIRA_GET_ISSUE_TYPES: "read",
    JIRA_GET_COMMENT: "read",
    JIRA_GET_COMPONENTS: "read",
    JIRA_LIST_SPRINTS: "read",
    JIRA_GET_CURRENT_USER: "read",
    JIRA_GET_ALL_USERS: "read",
    JIRA_GET_ALL_GROUPS: "read",
    JIRA_FIND_USERS2: "read",
    JIRA_FIND_USERS_FOR_PICKER: "read",
    JIRA_CHECK_PERMISSIONS: "read",
    JIRA_SEARCH_APPROXIMATE_COUNT: "read",
    JIRA_GET_CREATE_METADATA_ISSUE_TYPE_FIELDS: "read",
    JIRA_PARSE_JQL_QUERIES: "read",
    JIRA_EVALUATE_JIRA_EXPRESSION: "read",
    JIRA_ANALYSE_EXPRESSION: "read",
    JIRA_GET_PERMISSIONS: "read",
    JIRA_SEARCH_DASHBOARDS: "read",
    JIRA_GET_ATTACHMENT: "read",
    JIRA_GET_ATTACHMENT_META: "read",
    JIRA_FETCH_BULK_ISSUES: "read",
    JIRA_GET_ALL_ISSUE_TYPE_SCHEMES: "read",

    // Writes — gated for approval.
    JIRA_CREATE_ISSUE: "write",
    JIRA_EDIT_ISSUE: "write",
    JIRA_TRANSITION_ISSUE: "write",
    JIRA_ASSIGN_ISSUE: "write",
    JIRA_ADD_COMMENT: "write",
    JIRA_UPDATE_COMMENT: "write",
    JIRA_CREATE_ISSUE_LINK: "write",
    JIRA_ADD_ATTACHMENT: "write",
    JIRA_ADD_WATCHER_TO_ISSUE: "write",
    JIRA_ADD_WORKLOG: "write",
    JIRA_BULK_CREATE_ISSUE: "write",
    JIRA_MOVE_ISSUE_TO_SPRINT: "write",
    JIRA_CREATE_SPRINT: "write",
    JIRA_CREATE_BOARD: "write",
    JIRA_CREATE_PROJECT: "write",
    JIRA_CREATE_VERSION: "write",
    JIRA_ADD_USERS_TO_PROJECT_ROLE: "write",
    JIRA_ADD_USER_TO_GROUP: "write",
    JIRA_CREATE_GROUP: "write",
    JIRA_SEND_NOTIFICATION_FOR_ISSUE: "write",
    JIRA_CREATE_JQL_AUTOCOMPLETEDATA: "write",

    // Irreversible — gated, flagged as unrecoverable.
    JIRA_DELETE_ISSUE: "irreversible",
    JIRA_DELETE_COMMENT: "irreversible",
    JIRA_DELETE_ATTACHMENT: "irreversible",
    JIRA_DELETE_WORKLOG: "irreversible",
    JIRA_DELETE_VERSION: "irreversible",
  },
  reddit: {
    // Reads — pass straight through.
    REDDIT_RETRIEVE_REDDIT_POST: "read",
    REDDIT_RETRIEVE_POST_COMMENTS: "read",
    REDDIT_RETRIEVE_SPECIFIC_COMMENT: "read",
    REDDIT_SEARCH_ACROSS_SUBREDDITS: "read",
    REDDIT_GET_SUBREDDITS_SEARCH: "read",
    REDDIT_GET_SUBREDDIT_RULES: "read",
    REDDIT_GET: "read",
    REDDIT_GET_R_TOP: "read",
    REDDIT_GET_CONTROVERSIAL_POSTS: "read",
    REDDIT_GET_RANDOM: "read",
    REDDIT_GET_REDDIT_USER_ABOUT: "read",
    REDDIT_GET_ME_PREFS: "read",
    REDDIT_LIST_SUBREDDIT_POST_FLAIRS: "read",
    REDDIT_GET_USER_FLAIR: "read",
    REDDIT_GET_USERNAME_AVAILABLE: "read",
    REDDIT_GET_SCOPES: "read",

    // Writes — gated for approval.
    REDDIT_CREATE_REDDIT_POST: "write",
    REDDIT_POST_REDDIT_COMMENT: "write",
    REDDIT_EDIT_REDDIT_COMMENT_OR_POST: "write",
    REDDIT_TOGGLE_INBOX_REPLIES: "write",

    // Irreversible — gated, flagged as unrecoverable.
    REDDIT_DELETE_REDDIT_POST: "irreversible",
    REDDIT_DELETE_REDDIT_COMMENT: "irreversible",
  },
  zoom: {
    // Reads — pass straight through.
    ZOOM_GET_A_MEETING: "read",
    ZOOM_GET_A_MEETING_SUMMARY: "read",
    ZOOM_GET_A_WEBINAR: "read",
    ZOOM_GET_DAILY_USAGE_REPORT: "read",
    ZOOM_GET_IQ_CONVERSATION_COMMENTS: "read",
    ZOOM_GET_IQ_CONVERSATION_CONTENT_ANALYSIS: "read",
    ZOOM_GET_IQ_CONVERSATION_INTERACTIONS: "read",
    ZOOM_GET_IQ_CONVERSATION_SCORECARDS: "read",
    ZOOM_GET_IQ_DEAL: "read",
    ZOOM_GET_IQ_DEAL_ACTIVITIES: "read",
    ZOOM_GET_IQ_USER_CONVERSATIONS_PLAYLISTS: "read",
    ZOOM_GET_MARKETPLACE_USER_APPS: "read",
    ZOOM_GET_MARKETPLACE_USER_ENTITLEMENTS: "read",
    ZOOM_GET_MEETING_RECORDINGS: "read",
    ZOOM_GET_PAST_MEETING_PARTICIPANTS: "read",
    ZOOM_GET_PROJECT: "read",
    ZOOM_GET_USER: "read",
    ZOOM_GET_WHITEBOARD: "read",
    ZOOM_GET_WHITEBOARD_EXPORT_STATUS: "read",
    ZOOM_GET_WHITEBOARD_SESSION: "read",
    ZOOM_GET_ZRA_CONVERSATION_COMMENTS: "read",
    ZOOM_GET_ZRA_CONVERSATION_INTERACTIONS: "read",
    ZOOM_GET_ZRA_CONVERSATION_SCORECARDS: "read",
    ZOOM_GET_ZRA_DEAL_ACTIVITIES: "read",
    ZOOM_LIST_ALL_RECORDINGS: "read",
    ZOOM_LIST_ARCHIVED_FILES: "read",
    ZOOM_LIST_DEVICES: "read",
    ZOOM_LIST_IQ_CONVERSATIONS: "read",
    ZOOM_LIST_IQ_DEALS: "read",
    ZOOM_LIST_MARKETPLACE_APP_CUSTOM_FIELDS: "read",
    ZOOM_LIST_MEETINGS: "read",
    ZOOM_LIST_MEETING_SUMMARY_TEMPLATES: "read",
    ZOOM_LIST_PAST_MEETING_INSTANCES: "read",
    ZOOM_LIST_PROJECT_COLLABORATORS: "read",
    ZOOM_LIST_PROJECTS: "read",
    ZOOM_LIST_USERS_COLLABORATION_DEVICES: "read",
    ZOOM_LIST_USERS_SETTINGS: "read",
    ZOOM_LIST_WEBINAR_PARTICIPANTS: "read",
    ZOOM_LIST_WEBINAR_REGISTRANTS: "read",
    ZOOM_LIST_WEBINARS: "read",
    ZOOM_LIST_WHITEBOARDS: "read",
    ZOOM_LIST_ZRA_CONVERSATIONS: "read",
    ZOOM_LIST_ZRA_CRM_ACCOUNTS: "read",
    ZOOM_LIST_ZRA_CRM_CONTACTS: "read",
    ZOOM_LIST_ZRA_CRM_DEALS: "read",
    ZOOM_LIST_ZRA_CRM_LEADS: "read",
    ZOOM_LIST_ZRA_CRM_SETTINGS: "read",
    ZOOM_LIST_ZRA_DEALS: "read",
    ZOOM_LIST_ZRA_SCHEDULED: "read",
    ZOOM_LIST_ZRA_SETTINGS_INDICATORS: "read",
    ZOOM_LIST_ZRA_USER_CONVERSATION_PLAYLISTS: "read",
    ZOOM_SEARCH_COMPANY_CONTACTS: "read",
    ZOOM_VALIDATE_MARKETPLACE_APP_MANIFEST: "read",
    ZOOM_DOWNLOAD_IMPORTED_WHITEBOARD_FILE: "read",
    ZOOM_DOWNLOAD_WHITEBOARD_EXPORT: "read",
    ZOOM_DOWNLOAD_WHITEBOARD_SESSION_ACTIVITY: "read",

    // Writes — gated for approval.
    ZOOM_ADD_A_MEETING_REGISTRANT: "write",
    ZOOM_ADD_A_WEBINAR_REGISTRANT: "write",
    ZOOM_ADD_PROJECT_COLLABORATORS: "write",
    ZOOM_ADD_WHITEBOARD_COLLABORATOR: "write",
    ZOOM_APPLY_CLASSIFICATION_TO_WHITEBOARD: "write",
    ZOOM_CREATE_A_MEETING: "write",
    ZOOM_CREATE_IQ_CONVERSATION: "write",
    ZOOM_CREATE_IQ_CONVERSATION_COMMENT: "write",
    ZOOM_CREATE_IQ_USER_CONVERSATION: "write",
    ZOOM_CREATE_PROJECT: "write",
    ZOOM_CREATE_WHITEBOARD: "write",
    ZOOM_CREATE_WHITEBOARD_EXPORT: "write",
    ZOOM_CREATE_ZRA_CONVERSATION: "write",
    ZOOM_CREATE_ZRA_CONVERSATION_COMMENT: "write",
    ZOOM_CREATE_ZRA_CRM_ACCOUNTS: "write",
    ZOOM_CREATE_ZRA_CRM_CONTACTS: "write",
    ZOOM_CREATE_ZRA_CRM_DEALS: "write",
    ZOOM_CREATE_ZRA_CRM_LEADS: "write",
    ZOOM_CREATE_ZRA_CRM_SETTINGS: "write",
    ZOOM_CREATE_ZRA_USER_CONVERSATION: "write",
    ZOOM_IMPORT_WHITEBOARD: "write",
    ZOOM_UPLOAD_WHITEBOARD_FILE: "write",
    ZOOM_MOVE_WHITEBOARDS_TO_PROJECT: "write",
    ZOOM_REMOVE_WHITEBOARD_CLASSIFICATION: "write",
    ZOOM_REMOVE_WHITEBOARDS_FROM_PROJECT: "write",
    ZOOM_UPDATE_A_MEETING: "write",
    ZOOM_UPDATE_CLASSIFICATION_LABEL: "write",
    ZOOM_UPDATE_IQ_CONVERSATION_COMMENT: "write",
    ZOOM_UPDATE_IQ_CONVERSATION_HOST: "write",
    ZOOM_UPDATE_PROJECT: "write",
    ZOOM_UPDATE_PROJECT_COLLABORATORS: "write",
    ZOOM_UPDATE_WHITEBOARD_COLLABORATOR: "write",
    ZOOM_UPDATE_WHITEBOARD_SHARE_SETTINGS: "write",
    ZOOM_UPDATE_ZRA_CONVERSATION_COMMENT: "write",
    ZOOM_UPDATE_ZRA_CONVERSATION_HOST: "write",

    // Irreversible — gated, flagged as unrecoverable.
    ZOOM_DELETE_A_MEETING: "irreversible",
    ZOOM_DELETE_IQ_CONVERSATION: "irreversible",
    ZOOM_DELETE_IQ_CONVERSATION_COMMENT: "irreversible",
    ZOOM_DELETE_IQ_DEAL_ACTIVITIES: "irreversible",
    ZOOM_DELETE_MEETING_RECORDINGS: "irreversible",
    ZOOM_DELETE_PROJECT: "irreversible",
    ZOOM_DELETE_PROJECT_COLLABORATOR: "irreversible",
    ZOOM_DELETE_RECORDING_FILE: "irreversible",
    ZOOM_DELETE_WHITEBOARD: "irreversible",
    ZOOM_DELETE_WHITEBOARD_COLLABORATOR: "irreversible",
    ZOOM_DELETE_ZRA_CONVERSATION: "irreversible",
    ZOOM_DELETE_ZRA_CONVERSATION_COMMENT: "irreversible",
    ZOOM_DELETE_ZRA_CRM_SETTINGS: "irreversible",
    ZOOM_DELETE_ZRA_DEAL_ACTIVITIES: "irreversible",
  },
  youtube: {
    // Reads — pass straight through.
    YOUTUBE_GET_CHANNEL_ACTIVITIES: "read",
    YOUTUBE_GET_CHANNEL_ID_BY_HANDLE: "read",
    YOUTUBE_GET_CHANNEL_STATISTICS: "read",
    YOUTUBE_GET_VIDEO_DETAILS_BATCH: "read",
    YOUTUBE_GET_VIDEO_RATING: "read",
    YOUTUBE_LIST_CAPTION_TRACK: "read",
    YOUTUBE_LIST_CHANNELS: "read",
    YOUTUBE_LIST_CHANNEL_SECTIONS: "read",
    YOUTUBE_LIST_CHANNEL_VIDEOS: "read",
    YOUTUBE_LIST_COMMENTS: "read",
    YOUTUBE_LIST_COMMENT_THREADS: "read",
    YOUTUBE_LIST_COMMENT_THREADS2: "read",
    YOUTUBE_LIST_I18N_LANGUAGES: "read",
    YOUTUBE_LIST_I18N_REGIONS: "read",
    YOUTUBE_LIST_LIVE_CHAT_MESSAGES: "read",
    YOUTUBE_LIST_MOST_POPULAR_VIDEOS: "read",
    YOUTUBE_LIST_PLAYLIST_IMAGES: "read",
    YOUTUBE_LIST_PLAYLIST_ITEMS: "read",
    YOUTUBE_LIST_SUPER_CHAT_EVENTS: "read",
    YOUTUBE_LIST_USER_PLAYLISTS: "read",
    YOUTUBE_LIST_USER_SUBSCRIPTIONS: "read",
    YOUTUBE_LIST_VIDEO_ABUSE_REPORT_REASONS: "read",
    YOUTUBE_LIST_VIDEO_CATEGORIES: "read",
    YOUTUBE_LOAD_CAPTIONS: "read",
    YOUTUBE_SEARCH_YOU_TUBE: "read",

    // Writes — gated for approval.
    YOUTUBE_ADD_VIDEO_TO_PLAYLIST: "write",
    YOUTUBE_CREATE_CHANNEL_SECTION: "write",
    YOUTUBE_CREATE_COMMENT_REPLY: "write",
    YOUTUBE_CREATE_PLAYLIST: "write",
    YOUTUBE_POST_COMMENT: "write",
    YOUTUBE_RATE_VIDEO: "write",
    YOUTUBE_SUBSCRIBE_CHANNEL: "write",
    YOUTUBE_UNSUBSCRIBE_CHANNEL: "write",
    YOUTUBE_UPDATE_CAPTION: "write",
    YOUTUBE_UPDATE_CHANNEL: "write",
    YOUTUBE_UPDATE_CHANNEL_SECTION: "write",
    YOUTUBE_UPDATE_COMMENT: "write",
    YOUTUBE_UPDATE_PLAYLIST: "write",
    YOUTUBE_UPDATE_PLAYLIST_ITEM: "write",
    YOUTUBE_UPDATE_THUMBNAIL: "write",
    YOUTUBE_UPDATE_VIDEO: "write",
    YOUTUBE_UPLOAD_VIDEO: "write",
    YOUTUBE_MULTIPART_UPLOAD_VIDEO: "write",
    YOUTUBE_MARK_COMMENT_AS_SPAM: "write",
    YOUTUBE_REPORT_VIDEO_ABUSE: "write",
    YOUTUBE_SET_COMMENT_MODERATION_STATUS: "write",

    // Irreversible — gated, flagged as unrecoverable.
    YOUTUBE_DELETE_CHANNEL_SECTION: "irreversible",
    YOUTUBE_DELETE_COMMENT: "irreversible",
    YOUTUBE_DELETE_PLAYLIST: "irreversible",
    YOUTUBE_DELETE_PLAYLIST_ITEM: "irreversible",
    YOUTUBE_DELETE_VIDEO: "irreversible",
  },
  asana: {
    // Reads — pass straight through.
    ASANA_GET_A_PROJECT: "read",
    ASANA_GET_A_TASK: "read",
    ASANA_GET_ATTACHMENT: "read",
    ASANA_SEARCH_TASKS_IN_WORKSPACE: "read",
    ASANA_GET_A_USER_TASK_LIST: "read",
    ASANA_GET_USERS_FOR_TEAM: "read",
    ASANA_GET_USERS_FOR_WORKSPACE: "read",
    ASANA_GET_ALL_PROJECTS: "read",
    ASANA_GET_MULTIPLE_TASKS: "read",
    ASANA_GET_SECTIONS_FOR_PROJECT: "read",
    ASANA_GET_TAGS_FOR_TASK: "read",
    ASANA_GET_TAGS_FOR_WORKSPACE: "read",
    ASANA_GET_PROJECT_STATUS_UPDATES: "read",
    ASANA_GET_TASK_COMMENTS: "read",
    ASANA_GET_TEAMS_FOR_WORKSPACE: "read",
    ASANA_GET_PORTFOLIOS: "read",
    ASANA_GET_GOALS: "read",

    // Writes — gated for approval.
    ASANA_CREATE_A_TASK: "write",
    ASANA_UPDATE_A_TASK: "write",
    ASANA_CREATE_SUBTASK: "write",
    ASANA_CREATE_A_PROJECT: "write",
    ASANA_CREATE_SECTION_IN_PROJECT: "write",
    ASANA_ADD_TASK_TO_SECTION: "write",
    ASANA_CREATE_TASK_COMMENT: "write",
    ASANA_ADD_TAG_TO_TASK: "write",
    ASANA_ADD_FOLLOWERS_TO_TASK: "write",
    ASANA_ADD_TASK_DEPENDENCIES: "write",
    ASANA_CREATE_PROJECT_STATUS_UPDATE: "write",
    ASANA_CREATE_TAG: "write",
    ASANA_SET_PARENT_FOR_TASK: "write",

    // Irreversible — gated, flagged as unrecoverable.
    ASANA_DELETE_TASK: "irreversible",
    ASANA_DELETE_PROJECT: "irreversible",
    ASANA_DELETE_SECTION: "irreversible",
    ASANA_DELETE_TAG: "irreversible",
  },
  figma: {
    // Reads — pass straight through.
    FIGMA_DISCOVER_FIGMA_RESOURCES: "read",
    FIGMA_GET_FILE_JSON: "read",
    FIGMA_GET_FILE_METADATA: "read",
    FIGMA_GET_FILE_COMPONENTS: "read",
    FIGMA_GET_FILE_STYLES: "read",
    FIGMA_GET_COMMENTS_IN_A_FILE: "read",
    FIGMA_GET_VERSIONS_OF_A_FILE: "read",
    FIGMA_GET_PROJECTS_IN_A_TEAM: "read",
    FIGMA_GET_FILES_IN_A_PROJECT: "read",
    FIGMA_GET_LOCAL_VARIABLES: "read",
    FIGMA_EXTRACT_DESIGN_TOKENS: "read",
    FIGMA_EXTRACT_PROTOTYPE_INTERACTIONS: "read",
    FIGMA_RENDER_IMAGES_OF_FILE_NODES: "read",
    FIGMA_DOWNLOAD_FIGMA_IMAGES: "read",
    FIGMA_GET_TEAM_COMPONENTS: "read",
    FIGMA_DETECT_BACKGROUND: "read",
    FIGMA_GET_CURRENT_USER: "read",
    FIGMA_GET_ACTIVITY_LOGS: "read",
    FIGMA_GET_PUBLISHED_VARIABLES: "read",
    FIGMA_GET_TEAM_STYLES: "read",
    FIGMA_GET_FILE_NODES: "read",
    FIGMA_GET_IMAGE_FILLS: "read",
    FIGMA_GET_STYLE: "read",
    FIGMA_GET_REACTIONS_FOR_A_COMMENT: "read",
    FIGMA_GET_A_WEBHOOK: "read",
    FIGMA_GET_WEBHOOKS: "read",
    FIGMA_GET_TEAM_WEBHOOKS: "read",
    FIGMA_GET_LIBRARY_ANALYTICS_COMPONENT_ACTION_DATA: "read",
    FIGMA_GET_LIBRARY_ANALYTICS_COMPONENT_USAGE_DATA: "read",
    FIGMA_GET_LIBRARY_ANALYTICS_STYLE_ACTION_DATA: "read",
    FIGMA_GET_LIBRARY_ANALYTICS_STYLE_USAGE_DATA: "read",
    FIGMA_GET_LIBRARY_ANALYTICS_VARIABLE_ACTION_DATA: "read",
    FIGMA_GET_LIBRARY_ANALYTICS_VARIABLE_USAGE_DATA: "read",

    // Writes — gated for approval.
    FIGMA_ADD_A_COMMENT_TO_A_FILE: "write",
    FIGMA_ADD_A_REACTION_TO_A_COMMENT: "write",
    FIGMA_CREATE_A_WEBHOOK: "write",
    FIGMA_UPDATE_A_WEBHOOK: "write",
    FIGMA_CREATE_DEV_RESOURCES: "write",
    FIGMA_DESIGN_TOKENS_TO_TAILWIND: "write",
    FIGMA_CREATE_MODIFY_DELETE_VARIABLES: "write",

    // Irreversible — gated, flagged as unrecoverable.
    FIGMA_DELETE_A_COMMENT: "irreversible",
    FIGMA_DELETE_A_REACTION: "irreversible",
    FIGMA_DELETE_A_WEBHOOK: "irreversible",
    FIGMA_DELETE_DEV_RESOURCE: "irreversible",
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
