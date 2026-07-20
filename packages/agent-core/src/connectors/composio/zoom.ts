import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ZOOM_TOOLKIT = "zoom"

export const zoomComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "ZOOM_GET_A_MEETING",
    description: "Get details of a specific Zoom meeting. Read-only.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_A_MEETING_SUMMARY",
    description: "Get AI-generated summary for a past meeting. Read-only.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_A_WEBINAR",
    description: "Get details of a specific webinar. Read-only.",
    parameters: z
      .object({
        webinarId: z.string().describe("Webinar ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_DAILY_USAGE_REPORT",
    description: "Get daily usage report for a specific date. Read-only.",
    parameters: z
      .object({
        year: z.number().int().describe("Year"),
        month: z.number().int().describe("Month (1-12)"),
        day: z.number().int().describe("Day (1-31)"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_CONVERSATION_COMMENTS",
    description: "Get comments from a Zoom IQ conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        conversationType: z.string().describe("Conversation type"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_CONVERSATION_CONTENT_ANALYSIS",
    description: "Get content analysis for a Zoom IQ conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        conversationType: z.string().describe("Conversation type"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_CONVERSATION_INTERACTIONS",
    description: "Get interactions from a Zoom IQ conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        conversationType: z.string().describe("Conversation type"),
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_CONVERSATION_SCORECARDS",
    description: "Get scorecards for a Zoom IQ conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        conversationType: z.string().describe("Conversation type"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_DEAL",
    description: "Get details of a Zoom IQ deal. Read-only.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_DEAL_ACTIVITIES",
    description: "Get activities for a Zoom IQ deal. Read-only.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_IQ_USER_CONVERSATIONS_PLAYLISTS",
    description: "Get playlists of conversations for a Zoom IQ user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_MARKETPLACE_USER_APPS",
    description: "Get marketplace apps for a user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_MARKETPLACE_USER_ENTITLEMENTS",
    description: "Get marketplace entitlements for a user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID"),
        appId: z.string().optional().describe("App ID filter"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_MEETING_RECORDINGS",
    description: "Get cloud recordings for a meeting. Read-only.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_PAST_MEETING_PARTICIPANTS",
    description: "Get participants from a past meeting. Read-only.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_PROJECT",
    description: "Get details of a Zoom project. Read-only.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_USER",
    description: "Get details of a Zoom user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_WHITEBOARD",
    description: "Get details of a Zoom whiteboard. Read-only.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_WHITEBOARD_EXPORT_STATUS",
    description: "Get export status of a Zoom whiteboard. Read-only.",
    parameters: z
      .object({
        exportId: z.string().describe("Export ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_WHITEBOARD_SESSION",
    description: "Get details of a Zoom whiteboard session. Read-only.",
    parameters: z
      .object({
        sessionId: z.string().describe("Session ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_ZRA_CONVERSATION_COMMENTS",
    description: "Get comments from a ZRA conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_ZRA_CONVERSATION_INTERACTIONS",
    description: "Get interactions from a ZRA conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_ZRA_CONVERSATION_SCORECARDS",
    description: "Get scorecards for a ZRA conversation. Read-only.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_GET_ZRA_DEAL_ACTIVITIES",
    description: "Get activities for a ZRA deal. Read-only.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ALL_RECORDINGS",
    description: "List all cloud recordings for a user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
        pageSize: z.number().int().optional().describe("Items per page (1-300)"),
        pageNumber: z.number().int().optional().describe("Page number"),
        from: z.string().optional().describe("Start date (yyyy-MM-dd)"),
        to: z.string().optional().describe("End date (yyyy-MM-dd)"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ARCHIVED_FILES",
    description: "List archived files (meeting recordings). Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
        pageNumber: z.number().int().optional().describe("Page number"),
        from: z.string().optional().describe("Start date (yyyy-MM-dd)"),
        to: z.string().optional().describe("End date (yyyy-MM-dd)"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_DEVICES",
    description: "List Zoom devices for a user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_IQ_CONVERSATIONS",
    description: "List Zoom IQ conversations. Read-only.",
    parameters: z
      .object({
        conversationType: z.string().describe("Conversation type"),
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_IQ_DEALS",
    description: "List Zoom IQ deals. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_MARKETPLACE_APP_CUSTOM_FIELDS",
    description: "List custom fields for a marketplace app. Read-only.",
    parameters: z
      .object({
        appId: z.string().describe("App ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_MEETINGS",
    description: "List meetings for a Zoom user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
        pageSize: z.number().int().optional().describe("Items per page (1-300)"),
        pageNumber: z.number().int().optional().describe("Page number"),
        type: z.string().optional().describe("Meeting type: 'scheduled', 'live', 'upcoming'"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_MEETING_SUMMARY_TEMPLATES",
    description: "List meeting summary templates. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_PAST_MEETING_INSTANCES",
    description: "List past instances of a recurring meeting. Read-only.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_PROJECT_COLLABORATORS",
    description: "List collaborators for a Zoom project. Read-only.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_PROJECTS",
    description: "List Zoom projects. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_USERS_COLLABORATION_DEVICES",
    description: "List collaboration devices for a user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_USERS_SETTINGS",
    description: "List settings for a Zoom user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_WEBINAR_PARTICIPANTS",
    description: "List participants from a webinar. Read-only.",
    parameters: z
      .object({
        webinarId: z.string().describe("Webinar ID"),
        pageSize: z.number().int().optional().describe("Items per page (1-300)"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_WEBINAR_REGISTRANTS",
    description: "List registrants for a webinar. Read-only.",
    parameters: z
      .object({
        webinarId: z.string().describe("Webinar ID"),
        pageSize: z.number().int().optional().describe("Items per page (1-300)"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_WEBINARS",
    description: "List webinars for a Zoom user. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID or email"),
        pageSize: z.number().int().optional().describe("Items per page (1-300)"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_WHITEBOARDS",
    description: "List Zoom whiteboards. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_CONVERSATIONS",
    description: "List ZRA conversations. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_CRM_ACCOUNTS",
    description: "List ZRA CRM accounts. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_CRM_CONTACTS",
    description: "List ZRA CRM contacts. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_CRM_DEALS",
    description: "List ZRA CRM deals. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_CRM_LEADS",
    description: "List ZRA CRM leads. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_CRM_SETTINGS",
    description: "List ZRA CRM settings. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_DEALS",
    description: "List ZRA deals. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_SCHEDULED",
    description: "List scheduled ZRA items. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_SETTINGS_INDICATORS",
    description: "List ZRA settings indicators. Read-only.",
    parameters: z
      .object({
        pageSize: z.number().int().optional().describe("Items per page"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_LIST_ZRA_USER_CONVERSATION_PLAYLISTS",
    description: "List ZRA user conversation playlists. Read-only.",
    parameters: z
      .object({
        userId: z.string().describe("User ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_SEARCH_COMPANY_CONTACTS",
    description: "Search company contacts by email. Read-only.",
    parameters: z
      .object({
        email: z.string().describe("Email address to search"),
        pageSize: z.number().int().optional().describe("Items per page"),
        pageNumber: z.number().int().optional().describe("Page number"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_VALIDATE_MARKETPLACE_APP_MANIFEST",
    description: "Validate a marketplace app manifest. Read-only.",
    parameters: z
      .object({
        appId: z.string().describe("App ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_DOWNLOAD_IMPORTED_WHITEBOARD_FILE",
    description: "Download an imported whiteboard file. Read-only.",
    parameters: z
      .object({
        fileId: z.string().describe("File ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_DOWNLOAD_WHITEBOARD_EXPORT",
    description: "Download a whiteboard export file. Read-only.",
    parameters: z
      .object({
        exportId: z.string().describe("Export ID"),
      })
      .passthrough(),
  },
  {
    slug: "ZOOM_DOWNLOAD_WHITEBOARD_SESSION_ACTIVITY",
    description: "Download a whiteboard session activity file. Read-only.",
    parameters: z
      .object({
        sessionId: z.string().describe("Session ID"),
      })
      .passthrough(),
  },

  // ── Write / Execute actions ───────────────────────────────────
  {
    slug: "ZOOM_ADD_A_MEETING_REGISTRANT",
    description: "Register a user for a meeting. Requires user approval before it runs.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
        email: z.string().describe("Registrant email"),
        firstName: z.string().describe("First name"),
        lastName: z.string().optional().describe("Last name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add meeting registrant",
      preview: `Register ${String(a["email"] ?? "")} for meeting ${String(a["meetingId"] ?? "")}`,
      confirmText: "Add registrant",
    }),
  },
  {
    slug: "ZOOM_ADD_A_WEBINAR_REGISTRANT",
    description: "Register a user for a webinar. Requires user approval before it runs.",
    parameters: z
      .object({
        webinarId: z.string().describe("Webinar ID"),
        email: z.string().describe("Registrant email"),
        firstName: z.string().describe("First name"),
        lastName: z.string().optional().describe("Last name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add webinar registrant",
      preview: `Register ${String(a["email"] ?? "")} for webinar ${String(a["webinarId"] ?? "")}`,
      confirmText: "Add registrant",
    }),
  },
  {
    slug: "ZOOM_ADD_PROJECT_COLLABORATORS",
    description: "Add collaborators to a Zoom project. Requires user approval before it runs.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
        collaboratorIds: z.array(z.string()).describe("Collaborator user IDs"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add project collaborators",
      preview: `Add collaborators to project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Add collaborators",
    }),
  },
  {
    slug: "ZOOM_ADD_WHITEBOARD_COLLABORATOR",
    description: "Add a collaborator to a whiteboard. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        collaboratorId: z.string().describe("Collaborator user ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add whiteboard collaborator",
      preview: `Add collaborator ${String(a["collaboratorId"] ?? "").slice(0, 20)} to whiteboard`,
      confirmText: "Add collaborator",
    }),
  },
  {
    slug: "ZOOM_APPLY_CLASSIFICATION_TO_WHITEBOARD",
    description: "Apply a classification label to a whiteboard. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        classificationId: z.string().describe("Classification ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Apply classification",
      preview: `Apply classification to whiteboard ${String(a["whiteboardId"] ?? "").slice(0, 30)}`,
      confirmText: "Apply classification",
    }),
  },
  {
    slug: "ZOOM_CREATE_A_MEETING",
    description: "Create a new Zoom meeting. Requires user approval before it runs.",
    parameters: z
      .object({
        topic: z.string().describe("Meeting topic"),
        type: z.number().int().optional().describe("Meeting type (1=instant, 2=scheduled, 3=recurring)"),
        startTime: z.string().optional().describe("Start time (RFC 3339 format)"),
        duration: z.number().int().optional().describe("Duration in minutes"),
        timezone: z.string().optional().describe("Timezone (e.g. 'America/New_York')"),
        agenda: z.string().optional().describe("Meeting agenda"),
        settings: z.any().optional().describe("Meeting settings"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create meeting: ${String(a["topic"] ?? "").slice(0, 60)}`,
      preview: `Create meeting "${String(a["topic"] ?? "").slice(0, 80)}"`,
      confirmText: "Create meeting",
    }),
  },
  {
    slug: "ZOOM_CREATE_IQ_CONVERSATION",
    description: "Create a new Zoom IQ conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationType: z.string().describe("Conversation type"),
        name: z.string().describe("Conversation name"),
        topic: z.string().optional().describe("Conversation topic"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create IQ conversation",
      preview: `Create IQ conversation "${String(a["name"] ?? "").slice(0, 60)}"`,
      confirmText: "Create conversation",
    }),
  },
  {
    slug: "ZOOM_CREATE_IQ_CONVERSATION_COMMENT",
    description: "Add a comment to a Zoom IQ conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        conversationType: z.string().describe("Conversation type"),
        content: z.string().describe("Comment content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Comment on IQ conversation",
      preview: `Add comment to IQ conversation ${String(a["conversationId"] ?? "").slice(0, 30)}`,
      confirmText: "Add comment",
    }),
  },
  {
    slug: "ZOOM_CREATE_IQ_USER_CONVERSATION",
    description: "Create a user-scoped IQ conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        userId: z.string().describe("User ID"),
        conversationType: z.string().describe("Conversation type"),
        name: z.string().describe("Conversation name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create user IQ conversation",
      preview: `Create IQ conversation for user ${String(a["userId"] ?? "").slice(0, 20)}`,
      confirmText: "Create conversation",
    }),
  },
  {
    slug: "ZOOM_CREATE_PROJECT",
    description: "Create a new Zoom project. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Project name"),
        description: z.string().optional().describe("Project description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create project: ${String(a["name"] ?? "").slice(0, 60)}`,
      preview: `Create project "${String(a["name"] ?? "").slice(0, 80)}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "ZOOM_CREATE_WHITEBOARD",
    description: "Create a new Zoom whiteboard. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Whiteboard name"),
        content: z.any().optional().describe("Whiteboard content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create whiteboard: ${String(a["name"] ?? "").slice(0, 60)}`,
      preview: `Create whiteboard "${String(a["name"] ?? "").slice(0, 80)}"`,
      confirmText: "Create whiteboard",
    }),
  },
  {
    slug: "ZOOM_CREATE_WHITEBOARD_EXPORT",
    description: "Export a whiteboard to a file format. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        format: z.string().optional().describe("Export format (e.g. 'pdf', 'png', 'svg')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Export whiteboard",
      preview: `Export whiteboard ${String(a["whiteboardId"] ?? "").slice(0, 30)} to ${String(a["format"] ?? "default")}`,
      confirmText: "Export",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CONVERSATION",
    description: "Create a new ZRA conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Conversation name"),
        topic: z.string().optional().describe("Conversation topic"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create ZRA conversation",
      preview: `Create ZRA conversation "${String(a["name"] ?? "").slice(0, 60)}"`,
      confirmText: "Create conversation",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CONVERSATION_COMMENT",
    description: "Add a comment to a ZRA conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        content: z.string().describe("Comment content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Comment on ZRA conversation",
      preview: `Add comment to ZRA conversation ${String(a["conversationId"] ?? "").slice(0, 30)}`,
      confirmText: "Add comment",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CRM_ACCOUNTS",
    description: "Create a ZRA CRM account. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Account name"),
        domain: z.string().optional().describe("Account domain"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create ZRA account",
      preview: `Create ZRA CRM account "${String(a["name"] ?? "").slice(0, 60)}"`,
      confirmText: "Create account",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CRM_CONTACTS",
    description: "Create a ZRA CRM contact. Requires user approval before it runs.",
    parameters: z
      .object({
        firstName: z.string().describe("First name"),
        lastName: z.string().describe("Last name"),
        email: z.string().describe("Email address"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create ZRA contact",
      preview: `Create ZRA CRM contact ${String(a["firstName"] ?? "")} ${String(a["lastName"] ?? "")}`,
      confirmText: "Create contact",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CRM_DEALS",
    description: "Create a ZRA CRM deal. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Deal name"),
        amount: z.number().optional().describe("Deal amount"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create ZRA deal",
      preview: `Create ZRA CRM deal "${String(a["name"] ?? "").slice(0, 60)}"`,
      confirmText: "Create deal",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CRM_LEADS",
    description: "Create a ZRA CRM lead. Requires user approval before it runs.",
    parameters: z
      .object({
        firstName: z.string().describe("First name"),
        lastName: z.string().describe("Last name"),
        email: z.string().describe("Email address"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create ZRA lead",
      preview: `Create ZRA CRM lead ${String(a["firstName"] ?? "")} ${String(a["lastName"] ?? "")}`,
      confirmText: "Create lead",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_CRM_SETTINGS",
    description: "Create ZRA CRM settings. Requires user approval before it runs.",
    parameters: z
      .object({
        settings: z.any().describe("CRM settings object"),
      })
      .passthrough(),
    preview: () => ({
      title: "Create ZRA settings",
      preview: "Create ZRA CRM settings",
      confirmText: "Create settings",
    }),
  },
  {
    slug: "ZOOM_CREATE_ZRA_USER_CONVERSATION",
    description: "Create a user-scoped ZRA conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        userId: z.string().describe("User ID"),
        name: z.string().describe("Conversation name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create user ZRA conversation",
      preview: `Create ZRA conversation for user ${String(a["userId"] ?? "").slice(0, 20)}`,
      confirmText: "Create conversation",
    }),
  },
  {
    slug: "ZOOM_IMPORT_WHITEBOARD",
    description: "Import a whiteboard from a file. Requires user approval before it runs.",
    parameters: z
      .object({
        fileUrl: z.string().describe("Publicly accessible file URL"),
        name: z.string().optional().describe("Whiteboard name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Import whiteboard",
      preview: `Import whiteboard from ${String(a["fileUrl"] ?? "").slice(0, 60)}`,
      confirmText: "Import",
    }),
  },
  {
    slug: "ZOOM_UPLOAD_WHITEBOARD_FILE",
    description: "Upload a file to a whiteboard. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        fileUrl: z.string().describe("Publicly accessible file URL"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Upload whiteboard file",
      preview: `Upload file to whiteboard ${String(a["whiteboardId"] ?? "").slice(0, 30)}`,
      confirmText: "Upload",
    }),
  },
  {
    slug: "ZOOM_MOVE_WHITEBOARDS_TO_PROJECT",
    description: "Move whiteboards into a project. Requires user approval before it runs.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
        whiteboardIds: z.array(z.string()).describe("Whiteboard IDs to move"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Move whiteboards to project",
      preview: `Move ${String((a["whiteboardIds"] as string[])?.length ?? 0)} whiteboard(s) to project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Move to project",
    }),
  },
  {
    slug: "ZOOM_REMOVE_WHITEBOARD_CLASSIFICATION",
    description: "Remove classification from a whiteboard. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Remove whiteboard classification",
      preview: `Remove classification from whiteboard ${String(a["whiteboardId"] ?? "").slice(0, 30)}`,
      confirmText: "Remove classification",
    }),
  },
  {
    slug: "ZOOM_REMOVE_WHITEBOARDS_FROM_PROJECT",
    description: "Remove whiteboards from a project. Requires user approval before it runs.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
        whiteboardIds: z.array(z.string()).describe("Whiteboard IDs to remove"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Remove whiteboards from project",
      preview: `Remove ${String((a["whiteboardIds"] as string[])?.length ?? 0)} whiteboard(s) from project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Remove from project",
    }),
  },
  {
    slug: "ZOOM_UPDATE_A_MEETING",
    description: "Update a Zoom meeting's details. Requires user approval before it runs.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
        topic: z.string().optional().describe("Meeting topic"),
        startTime: z.string().optional().describe("Start time (RFC 3339 format)"),
        duration: z.number().int().optional().describe("Duration in minutes"),
        timezone: z.string().optional().describe("Timezone"),
        agenda: z.string().optional().describe("Meeting agenda"),
        settings: z.any().optional().describe("Meeting settings"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update meeting",
      preview: `Update meeting ${String(a["meetingId"] ?? "")}`,
      confirmText: "Update meeting",
    }),
  },
  {
    slug: "ZOOM_UPDATE_CLASSIFICATION_LABEL",
    description: "Update a classification label. Requires user approval before it runs.",
    parameters: z
      .object({
        classificationId: z.string().describe("Classification ID"),
        label: z.string().describe("New label"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update classification label",
      preview: `Update classification ${String(a["classificationId"] ?? "").slice(0, 30)} to "${String(a["label"] ?? "").slice(0, 40)}"`,
      confirmText: "Update label",
    }),
  },
  {
    slug: "ZOOM_UPDATE_IQ_CONVERSATION_COMMENT",
    description: "Update a Zoom IQ conversation comment. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        commentId: z.string().describe("Comment ID"),
        content: z.string().describe("Updated comment content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update IQ comment",
      preview: `Update comment ${String(a["commentId"] ?? "").slice(0, 20)} in IQ conversation`,
      confirmText: "Update comment",
    }),
  },
  {
    slug: "ZOOM_UPDATE_IQ_CONVERSATION_HOST",
    description: "Transfer host of a Zoom IQ conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        hostId: z.string().describe("New host user ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Transfer IQ host",
      preview: `Transfer IQ conversation host to ${String(a["hostId"] ?? "").slice(0, 20)}`,
      confirmText: "Transfer host",
    }),
  },
  {
    slug: "ZOOM_UPDATE_PROJECT",
    description: "Update a Zoom project's details. Requires user approval before it runs.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
        name: z.string().optional().describe("Project name"),
        description: z.string().optional().describe("Project description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update project",
      preview: `Update project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Update project",
    }),
  },
  {
    slug: "ZOOM_UPDATE_PROJECT_COLLABORATORS",
    description: "Update collaborators on a Zoom project. Requires user approval before it runs.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
        collaboratorIds: z.array(z.string()).describe("Updated list of collaborator user IDs"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update project collaborators",
      preview: `Update collaborators for project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Update collaborators",
    }),
  },
  {
    slug: "ZOOM_UPDATE_WHITEBOARD_COLLABORATOR",
    description: "Update a whiteboard collaborator's permissions. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        collaboratorId: z.string().describe("Collaborator user ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update whiteboard collaborator",
      preview: `Update collaborator ${String(a["collaboratorId"] ?? "").slice(0, 20)} on whiteboard`,
      confirmText: "Update collaborator",
    }),
  },
  {
    slug: "ZOOM_UPDATE_WHITEBOARD_SHARE_SETTINGS",
    description: "Update share settings for a whiteboard. Requires user approval before it runs.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        settings: z.any().describe("Share settings object"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update whiteboard share settings",
      preview: `Update share settings for whiteboard ${String(a["whiteboardId"] ?? "").slice(0, 30)}`,
      confirmText: "Update settings",
    }),
  },
  {
    slug: "ZOOM_UPDATE_ZRA_CONVERSATION_COMMENT",
    description: "Update a ZRA conversation comment. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        commentId: z.string().describe("Comment ID"),
        content: z.string().describe("Updated comment content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update ZRA comment",
      preview: `Update comment ${String(a["commentId"] ?? "").slice(0, 20)} in ZRA conversation`,
      confirmText: "Update comment",
    }),
  },
  {
    slug: "ZOOM_UPDATE_ZRA_CONVERSATION_HOST",
    description: "Transfer host of a ZRA conversation. Requires user approval before it runs.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        hostId: z.string().describe("New host user ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Transfer ZRA host",
      preview: `Transfer ZRA conversation host to ${String(a["hostId"] ?? "").slice(0, 20)}`,
      confirmText: "Transfer host",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "ZOOM_DELETE_A_MEETING",
    description: "Permanently delete a Zoom meeting. Irreversible.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete meeting",
      preview: `Permanently delete meeting ${String(a["meetingId"] ?? "")}`,
      confirmText: "Delete meeting",
    }),
  },
  {
    slug: "ZOOM_DELETE_IQ_CONVERSATION",
    description: "Permanently delete a Zoom IQ conversation. Irreversible.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete IQ conversation",
      preview: `Permanently delete IQ conversation ${String(a["conversationId"] ?? "").slice(0, 30)}`,
      confirmText: "Delete conversation",
    }),
  },
  {
    slug: "ZOOM_DELETE_IQ_CONVERSATION_COMMENT",
    description: "Permanently delete a Zoom IQ conversation comment. Irreversible.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        commentId: z.string().describe("Comment ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete IQ comment",
      preview: `Permanently delete comment ${String(a["commentId"] ?? "").slice(0, 20)} from IQ conversation`,
      confirmText: "Delete comment",
    }),
  },
  {
    slug: "ZOOM_DELETE_IQ_DEAL_ACTIVITIES",
    description: "Permanently delete activities from an IQ deal. Irreversible.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
        activityIds: z.array(z.string()).describe("Activity IDs to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete IQ deal activities",
      preview: `Delete ${String((a["activityIds"] as string[])?.length ?? 0)} activity(ies) from IQ deal ${String(a["dealId"] ?? "").slice(0, 20)}`,
      confirmText: "Delete activities",
    }),
  },
  {
    slug: "ZOOM_DELETE_MEETING_RECORDINGS",
    description: "Permanently delete meeting cloud recordings. Irreversible.",
    parameters: z
      .object({
        meetingId: z.string().describe("Meeting ID"),
        recordingIds: z.array(z.string()).optional().describe("Recording IDs to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete meeting recordings",
      preview: `Delete recordings for meeting ${String(a["meetingId"] ?? "")}`,
      confirmText: "Delete recordings",
    }),
  },
  {
    slug: "ZOOM_DELETE_PROJECT",
    description: "Permanently delete a Zoom project. Irreversible.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete project",
      preview: `Permanently delete project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Delete project",
    }),
  },
  {
    slug: "ZOOM_DELETE_PROJECT_COLLABORATOR",
    description: "Remove a collaborator from a project. Irreversible.",
    parameters: z
      .object({
        projectId: z.string().describe("Project ID"),
        collaboratorId: z.string().describe("Collaborator user ID to remove"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Remove project collaborator",
      preview: `Remove collaborator ${String(a["collaboratorId"] ?? "").slice(0, 20)} from project ${String(a["projectId"] ?? "").slice(0, 30)}`,
      confirmText: "Remove collaborator",
    }),
  },
  {
    slug: "ZOOM_DELETE_RECORDING_FILE",
    description: "Permanently delete a specific recording file. Irreversible.",
    parameters: z
      .object({
        recordingId: z.string().describe("Recording file ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete recording file",
      preview: `Permanently delete recording file ${String(a["recordingId"] ?? "").slice(0, 30)}`,
      confirmText: "Delete recording",
    }),
  },
  {
    slug: "ZOOM_DELETE_WHITEBOARD",
    description: "Permanently delete a Zoom whiteboard. Irreversible.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete whiteboard",
      preview: `Permanently delete whiteboard ${String(a["whiteboardId"] ?? "").slice(0, 30)}`,
      confirmText: "Delete whiteboard",
    }),
  },
  {
    slug: "ZOOM_DELETE_WHITEBOARD_COLLABORATOR",
    description: "Remove a collaborator from a whiteboard. Irreversible.",
    parameters: z
      .object({
        whiteboardId: z.string().describe("Whiteboard ID"),
        collaboratorId: z.string().describe("Collaborator user ID to remove"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Remove whiteboard collaborator",
      preview: `Remove collaborator ${String(a["collaboratorId"] ?? "").slice(0, 20)} from whiteboard`,
      confirmText: "Remove collaborator",
    }),
  },
  {
    slug: "ZOOM_DELETE_ZRA_CONVERSATION",
    description: "Permanently delete a ZRA conversation. Irreversible.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete ZRA conversation",
      preview: `Permanently delete ZRA conversation ${String(a["conversationId"] ?? "").slice(0, 30)}`,
      confirmText: "Delete conversation",
    }),
  },
  {
    slug: "ZOOM_DELETE_ZRA_CONVERSATION_COMMENT",
    description: "Permanently delete a ZRA conversation comment. Irreversible.",
    parameters: z
      .object({
        conversationId: z.string().describe("Conversation ID"),
        commentId: z.string().describe("Comment ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete ZRA comment",
      preview: `Permanently delete comment ${String(a["commentId"] ?? "").slice(0, 20)} from ZRA conversation`,
      confirmText: "Delete comment",
    }),
  },
  {
    slug: "ZOOM_DELETE_ZRA_CRM_SETTINGS",
    description: "Permanently delete ZRA CRM settings. Irreversible.",
    parameters: z
      .object({
        settingsId: z.string().describe("Settings ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete ZRA settings",
      preview: `Permanently delete ZRA CRM settings ${String(a["settingsId"] ?? "").slice(0, 30)}`,
      confirmText: "Delete settings",
    }),
  },
  {
    slug: "ZOOM_DELETE_ZRA_DEAL_ACTIVITIES",
    description: "Permanently delete activities from a ZRA deal. Irreversible.",
    parameters: z
      .object({
        dealId: z.string().describe("Deal ID"),
        activityIds: z.array(z.string()).describe("Activity IDs to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete ZRA deal activities",
      preview: `Delete ${String((a["activityIds"] as string[])?.length ?? 0)} activity(ies) from ZRA deal ${String(a["dealId"] ?? "").slice(0, 20)}`,
      confirmText: "Delete activities",
    }),
  },
]

export function makeComposioZoomDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "zoom",
    name: "Zoom",
    category: "meetings",
    icon: "zoom",
    description: "Schedule and manage Zoom meetings, webinars, recordings, whiteboards, and user settings (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ZOOM_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ZOOM_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Zoom auth config in Composio (uses OAuth2)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ZOOM_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=zoom to route Zoom through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_ZOOM_AUTH_CONFIG_ID", label: "Composio Zoom auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/zoom",
    },
    tools: createComposioTools({
      provider: "zoom",
      toolkit: ZOOM_TOOLKIT,
      specs: zoomComposioSpecs,
      executor,
    }),
  }
}
