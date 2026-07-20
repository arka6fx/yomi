import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const YOUTUBE_TOOLKIT = "youtube"

export const youtubeComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "YOUTUBE_GET_CHANNEL_ACTIVITIES",
    description:
      "Get recent activities from a YouTube channel (video uploads, playlist additions, likes). Read-only.",
    parameters: z
      .object({
        channelId: z.string().describe("YouTube channel ID (starts with 'UC')"),
        part: z.string().optional().describe("Comma-separated resource properties (e.g. 'snippet,contentDetails')"),
        maxResults: z.number().int().optional().describe("Max activities to return"),
        pageToken: z.string().optional().describe("Pagination token"),
        publishedAfter: z.string().optional().describe("RFC 3339 date-time filter"),
        publishedBefore: z.string().optional().describe("RFC 3339 date-time filter"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_GET_CHANNEL_ID_BY_HANDLE",
    description:
      "Get the YouTube Channel ID for a channel handle. Read-only.",
    parameters: z
      .object({
        channel_handle: z.string().describe("Channel handle, e.g. '@Google' or 'Google'"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_GET_CHANNEL_STATISTICS",
    description:
      "Get detailed statistics for YouTube channels (subscriber count, view count, video count). Read-only.",
    parameters: z
      .object({
        id: z.string().optional().describe("Comma-separated channel IDs"),
        forHandle: z.string().optional().describe("Channel handle (e.g. '@Google')"),
        forUsername: z.string().optional().describe("Legacy channel username"),
        mine: z.coerce.boolean().optional().describe("Fetch the authenticated user's channel"),
        part: z.string().optional().describe("Resource properties (e.g. 'statistics')"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
    description:
      "Retrieve multiple YouTube video details in a single batch call. Read-only.",
    parameters: z
      .object({
        id: z.array(z.string()).describe("List of YouTube video IDs"),
        parts: z.array(z.string()).optional().describe("Resource properties (default: ['snippet', 'statistics'])"),
        hl: z.string().optional().describe("Language for localized metadata"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_GET_VIDEO_RATING",
    description:
      "Get the ratings (like/dislike) the authorized user gave to specified videos. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("Comma-separated YouTube video IDs"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_CAPTION_TRACK",
    description:
      "List caption tracks for a YouTube video. Read-only.",
    parameters: z
      .object({
        video_id: z.string().describe("YouTube video ID"),
        part: z.string().optional().describe("Resource parts (default: 'snippet')"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_CHANNELS",
    description:
      "List YouTube channels by ID, handle, username, or ownership. Read-only.",
    parameters: z
      .object({
        id: z.string().optional().describe("Comma-separated channel IDs"),
        forHandle: z.string().optional().describe("Channel handle"),
        forUsername: z.string().optional().describe("Username"),
        mine: z.coerce.boolean().optional().describe("Authenticated user's channel"),
        managedByMe: z.coerce.boolean().optional().describe("Channels managed by user"),
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page (0-50)"),
        pageToken: z.string().optional().describe("Pagination token"),
        hl: z.string().optional().describe("Language code"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_CHANNEL_SECTIONS",
    description:
      "Get the layout sections of a channel's homepage. Read-only.",
    parameters: z
      .object({
        part: z.string().describe("Resource properties (e.g. 'snippet,contentDetails')"),
        channelId: z.string().optional().describe("Channel ID"),
        id: z.string().optional().describe("Comma-separated section IDs"),
        mine: z.coerce.boolean().optional().describe("Authenticated user's channel"),
        hl: z.string().optional().describe("Language code"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_CHANNEL_VIDEOS",
    description:
      "List videos from a YouTube channel. Read-only.",
    parameters: z
      .object({
        channelId: z.string().optional().describe("Channel ID, handle, or '@handle'"),
        mine: z.coerce.boolean().optional().describe("Authenticated user's channel"),
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page"),
        pageToken: z.string().optional().describe("Pagination token"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_COMMENTS",
    description:
      "List individual comments from YouTube videos. Read-only.",
    parameters: z
      .object({
        parentId: z.string().optional().describe("Parent comment ID for replies"),
        id: z.string().optional().describe("Comma-separated comment IDs"),
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page (1-100)"),
        pageToken: z.string().optional().describe("Pagination token"),
        textFormat: z.enum(["html", "plainText"]).optional().describe("Text format"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_COMMENT_THREADS",
    description:
      "DEPRECATED: Use YOUTUBE_LIST_COMMENT_THREADS2 instead. Read-only.",
    parameters: z
      .object({
        videoId: z.string().optional().describe("Video ID"),
        id: z.string().optional().describe("Comma-separated thread IDs"),
        allThreadsRelatedToChannelId: z.string().optional().describe("Channel ID"),
        part: z.string().optional().describe("Resource properties"),
        order: z.enum(["time", "relevance"]).optional().describe("Sort order"),
        maxResults: z.number().int().optional().describe("Max per page (1-100)"),
        pageToken: z.string().optional().describe("Pagination token"),
        textFormat: z.enum(["html", "plainText"]).optional().describe("Text format"),
        searchTerms: z.string().optional().describe("Search filter"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_COMMENT_THREADS2",
    description:
      "List comment threads from YouTube videos or channels. Read-only.",
    parameters: z
      .object({
        part: z.string().describe("Resource properties (e.g. 'snippet,replies')"),
        videoId: z.string().optional().describe("Video ID"),
        channelId: z.string().optional().describe("Channel ID"),
        id: z.string().optional().describe("Comma-separated thread IDs"),
        allThreadsRelatedToChannelId: z.string().optional().describe("Channel ID"),
        order: z.enum(["relevance", "time"]).optional().describe("Sort order"),
        maxResults: z.number().int().optional().describe("Max per page (1-100)"),
        pageToken: z.string().optional().describe("Pagination token"),
        textFormat: z.enum(["html", "plainText"]).optional().describe("Text format"),
        searchTerms: z.string().optional().describe("Search filter"),
        moderationStatus: z.enum(["heldForReview", "likelySpam", "published"]).optional().describe("Moderation filter"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_I18N_LANGUAGES",
    description:
      "List application languages that YouTube supports. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties (default: 'snippet')"),
        hl: z.string().optional().describe("Language for response text"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_I18N_REGIONS",
    description:
      "List content regions that YouTube supports. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties (default: 'snippet')"),
        hl: z.string().optional().describe("Language for response text"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_LIVE_CHAT_MESSAGES",
    description:
      "List live chat messages for a broadcast. Read-only.",
    parameters: z
      .object({
        liveChatId: z.string().describe("Live chat ID from broadcast resource"),
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Messages per page (200-2000)"),
        pageToken: z.string().optional().describe("Pagination token"),
        hl: z.string().optional().describe("Language code"),
        profileImageSize: z.number().int().optional().describe("Profile picture size in px"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_MOST_POPULAR_VIDEOS",
    description:
      "DEPRECATED: Use YOUTUBE_UPDATE_VIDEO instead. List trending YouTube videos. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties"),
        chart: z.string().optional().describe("Chart type (default: 'mostPopular')"),
        maxResults: z.number().int().optional().describe("Max per page (1-50)"),
        pageToken: z.string().optional().describe("Pagination token"),
        regionCode: z.string().optional().describe("ISO 3166-1 alpha-2 region code"),
        videoCategoryId: z.string().optional().describe("Category ID filter"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_PLAYLIST_IMAGES",
    description:
      "Retrieve playlist custom thumbnail images. Read-only.",
    parameters: z
      .object({
        parent: z.string().optional().describe("Playlist ID"),
        id: z.string().optional().describe("Comma-separated image IDs"),
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page (0-50)"),
        pageToken: z.string().optional().describe("Pagination token"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_PLAYLIST_ITEMS",
    description:
      "List videos in a playlist with pagination. Read-only.",
    parameters: z
      .object({
        playlistId: z.string().describe("Playlist ID"),
        part: z.string().optional().describe("Resource properties"),
        videoId: z.string().optional().describe("Filter by video ID"),
        maxResults: z.number().int().optional().describe("Max per page (0-50)"),
        pageToken: z.string().optional().describe("Pagination token"),
        fields: z.string().optional().describe("Partial response field selector"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_SUPER_CHAT_EVENTS",
    description:
      "List Super Chat events (supporter purchases during live streams). Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page (1-50)"),
        pageToken: z.string().optional().describe("Pagination token"),
        hl: z.string().optional().describe("Language code"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_USER_PLAYLISTS",
    description:
      "Retrieve playlists owned by the authenticated user. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page"),
        pageToken: z.string().optional().describe("Pagination token"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
    description:
      "Retrieve the authenticated user's channel subscriptions. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties"),
        maxResults: z.number().int().optional().describe("Max per page"),
        pageToken: z.string().optional().describe("Pagination token"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_VIDEO_ABUSE_REPORT_REASONS",
    description:
      "List abuse report reasons for reporting YouTube videos. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties"),
        hl: z.string().optional().describe("Language code"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LIST_VIDEO_CATEGORIES",
    description:
      "List YouTube video categories for a region. Read-only.",
    parameters: z
      .object({
        part: z.string().optional().describe("Resource properties"),
        id: z.string().optional().describe("Comma-separated category IDs"),
        hl: z.string().optional().describe("Language code"),
        regionCode: z.string().optional().describe("ISO 3166-1 alpha-2 region"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_LOAD_CAPTIONS",
    description:
      "Download caption track content for a YouTube video. Read-only.",
    parameters: z
      .object({
        id: z.string().describe("Caption track ID"),
      })
      .passthrough(),
  },
  {
    slug: "YOUTUBE_SEARCH_YOU_TUBE",
    description:
      "Search YouTube videos, channels, and playlists by keyword. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        part: z.string().optional().describe("Resource properties"),
        type: z.string().optional().describe("Resource type: 'video', 'channel', 'playlist'"),
        maxResults: z.number().int().optional().describe("Max results (1-50)"),
        order: z.string().optional().describe("Sort: 'relevance', 'date', 'rating', 'viewCount'"),
        pageToken: z.string().optional().describe("Pagination token"),
        regionCode: z.string().optional().describe("ISO 3166-1 alpha-2 region"),
        publishedAfter: z.string().optional().describe("RFC 3339 date-time"),
        videoDuration: z.string().optional().describe("Duration: 'any', 'short', 'medium', 'long'"),
        videoCaption: z.string().optional().describe("Caption: 'any', 'closedCaption', 'none'"),
        channelId: z.string().optional().describe("Channel ID to search within"),
      })
      .passthrough(),
  },

  // ── Write / Execute actions ───────────────────────────────────
  {
    slug: "YOUTUBE_ADD_VIDEO_TO_PLAYLIST",
    description:
      "Add a video to a playlist. Requires user approval before it runs.",
    parameters: z
      .object({
        playlistId: z.string().describe("Playlist ID"),
        videoId: z.string().describe("YouTube video ID to add"),
        position: z.number().int().optional().describe("Zero-based position in the playlist"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add video to playlist",
      preview: `Add video ${String(a["videoId"] ?? "")} to playlist ${String(a["playlistId"] ?? "")}`,
      confirmText: "Add to playlist",
    }),
  },
  {
    slug: "YOUTUBE_CREATE_CHANNEL_SECTION",
    description:
      "Create a new channel section for the authenticated user's channel. Requires user approval before it runs.",
    parameters: z
      .object({
        snippet: z.any().describe("Section snippet object (type, title, position)"),
        contentDetails: z.any().optional().describe("Content details for the section"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create channel section",
      preview: "Create a new channel section",
      confirmText: "Create section",
    }),
  },
  {
    slug: "YOUTUBE_CREATE_COMMENT_REPLY",
    description:
      "Reply to an existing YouTube comment. Requires user approval before it runs.",
    parameters: z
      .object({
        parentId: z.string().describe("Parent comment ID to reply to"),
        textOriginal: z.string().describe("Reply text content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Reply to comment",
      preview: `Reply to comment ${String(a["parentId"] ?? "").slice(0, 30)}`,
      confirmText: "Reply",
    }),
  },
  {
    slug: "YOUTUBE_CREATE_PLAYLIST",
    description:
      "Create a new YouTube playlist on the authenticated user's channel. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Playlist title"),
        description: z.string().optional().describe("Playlist description"),
        privacyStatus: z.enum(["public", "private", "unlisted"]).optional().describe("Privacy setting"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create playlist: ${String(a["title"] ?? "").slice(0, 60)}`,
      preview: `Create playlist "${String(a["title"] ?? "").slice(0, 80)}"`,
      confirmText: "Create playlist",
    }),
  },
  {
    slug: "YOUTUBE_POST_COMMENT",
    description:
      "Post a comment on a YouTube video. Requires user approval before it runs.",
    parameters: z
      .object({
        videoId: z.string().describe("YouTube video ID"),
        textOriginal: z.string().describe("Comment text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Post comment",
      preview: `Comment on video ${String(a["videoId"] ?? "").slice(0, 20)}`,
      confirmText: "Post comment",
    }),
  },
  {
    slug: "YOUTUBE_RATE_VIDEO",
    description:
      "Like or dislike a YouTube video. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("YouTube video ID"),
        rating: z.enum(["like", "dislike", "none"]).describe("Rating to apply"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `${String(a["rating"] ?? "rate")} video`,
      preview: `${String(a["rating"] ?? "Rate")} video ${String(a["id"] ?? "").slice(0, 20)}`,
      confirmText: `${String(a["rating"] ?? "rate")}`,
    }),
  },
  {
    slug: "YOUTUBE_SUBSCRIBE_CHANNEL",
    description:
      "Subscribe to a YouTube channel. Requires user approval before it runs.",
    parameters: z
      .object({
        channelId: z.string().describe("Channel ID to subscribe to"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Subscribe to channel",
      preview: `Subscribe to channel ${String(a["channelId"] ?? "").slice(0, 30)}`,
      confirmText: "Subscribe",
    }),
  },
  {
    slug: "YOUTUBE_UNSUBSCRIBE_CHANNEL",
    description:
      "Unsubscribe from a YouTube channel. Requires user approval before it runs.",
    parameters: z
      .object({
        channelId: z.string().describe("Channel ID to unsubscribe from"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Unsubscribe from channel",
      preview: `Unsubscribe from channel ${String(a["channelId"] ?? "").slice(0, 30)}`,
      confirmText: "Unsubscribe",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_CAPTION",
    description:
      "Update a caption track. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("Caption track ID to update"),
        part: z.string().optional().describe("Resource properties"),
        body: z.any().describe("Caption resource body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update caption",
      preview: `Update caption track ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Update caption",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_CHANNEL",
    description:
      "Update a YouTube channel's metadata. Requires user approval before it runs.",
    parameters: z
      .object({
        part: z.string().describe("Resource properties to update"),
        body: z.any().optional().describe("Channel resource body"),
      })
      .passthrough(),
    preview: () => ({
      title: "Update channel",
      preview: "Update YouTube channel metadata",
      confirmText: "Update channel",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_CHANNEL_SECTION",
    description:
      "Update a channel section. Requires user approval before it runs.",
    parameters: z
      .object({
        part: z.string().describe("Resource properties to update"),
        body: z.any().describe("Channel section resource body"),
      })
      .passthrough(),
    preview: () => ({
      title: "Update channel section",
      preview: "Update YouTube channel section",
      confirmText: "Update section",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_COMMENT",
    description:
      "Update a YouTube comment. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("Comment ID to update"),
        part: z.string().optional().describe("Resource properties"),
        body: z.any().describe("Comment resource body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update comment",
      preview: `Update comment ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Update comment",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_PLAYLIST",
    description:
      "Update a playlist's metadata. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("Playlist ID to update"),
        part: z.string().optional().describe("Resource properties"),
        body: z.any().optional().describe("Playlist resource body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update playlist",
      preview: `Update playlist ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Update playlist",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_PLAYLIST_ITEM",
    description:
      "Update a playlist item's metadata. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("Playlist item ID"),
        part: z.string().optional().describe("Resource properties"),
        body: z.any().optional().describe("Playlist item resource body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update playlist item",
      preview: `Update playlist item ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Update item",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_THUMBNAIL",
    description:
      "Set a custom thumbnail for a YouTube video. Requires user approval before it runs.",
    parameters: z
      .object({
        videoId: z.string().describe("Video ID to set thumbnail for"),
        part: z.string().optional().describe("Resource properties"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update thumbnail",
      preview: `Set thumbnail for video ${String(a["videoId"] ?? "").slice(0, 20)}`,
      confirmText: "Update thumbnail",
    }),
  },
  {
    slug: "YOUTUBE_UPDATE_VIDEO",
    description:
      "DEPRECATED: Use YOUTUBE_UPDATE_VIDEO instead. Update a YouTube video's metadata. Requires user approval before it runs.",
    parameters: z
      .object({
        videoId: z.string().describe("Video ID to update"),
        part: z.string().optional().describe("Resource properties"),
        body: z.any().optional().describe("Video resource body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update video",
      preview: `Update video ${String(a["videoId"] ?? "").slice(0, 20)}`,
      confirmText: "Update video",
    }),
  },
  {
    slug: "YOUTUBE_UPLOAD_VIDEO",
    description:
      "Upload a video to the authenticated user's YouTube channel. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Video title"),
        description: z.string().optional().describe("Video description"),
        privacyStatus: z.enum(["public", "private", "unlisted"]).optional().describe("Privacy setting"),
        tags: z.array(z.string()).optional().describe("Video tags"),
        categoryId: z.string().optional().describe("YouTube category ID"),
        madeForKids: z.coerce.boolean().optional().describe("Whether video is made for kids"),
        fileUrl: z.string().describe("Publicly accessible URL of the video file to upload"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Upload video: ${String(a["title"] ?? "").slice(0, 60)}`,
      preview: `Upload "${String(a["title"] ?? "").slice(0, 80)}" to YouTube`,
      confirmText: "Upload video",
    }),
  },
  {
    slug: "YOUTUBE_MULTIPART_UPLOAD_VIDEO",
    description:
      "Upload a video using multipart data. Requires user approval before it runs.",
    parameters: z
      .object({
        title: z.string().describe("Video title"),
        description: z.string().optional().describe("Video description"),
        privacyStatus: z.enum(["public", "private", "unlisted"]).optional().describe("Privacy setting"),
        tags: z.array(z.string()).optional().describe("Video tags"),
        categoryId: z.string().optional().describe("YouTube category ID"),
        fileUrl: z.string().describe("Publicly accessible URL of the video file"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Upload video (multipart): ${String(a["title"] ?? "").slice(0, 60)}`,
      preview: `Upload "${String(a["title"] ?? "").slice(0, 80)}" to YouTube (multipart)`,
      confirmText: "Upload video",
    }),
  },
  {
    slug: "YOUTUBE_MARK_COMMENT_AS_SPAM",
    description:
      "Mark a YouTube comment as spam. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("Comment ID to mark as spam"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Mark comment as spam",
      preview: `Mark comment ${String(a["id"] ?? "").slice(0, 30)} as spam`,
      confirmText: "Mark as spam",
    }),
  },
  {
    slug: "YOUTUBE_REPORT_VIDEO_ABUSE",
    description:
      "Report a video for abuse. Requires user approval before it runs.",
    parameters: z
      .object({
        videoId: z.string().describe("Video ID to report"),
        reasonId: z.string().optional().describe("Abuse reason ID"),
        secondaryReasonId: z.string().optional().describe("Secondary reason ID"),
        comments: z.string().optional().describe("Additional comments about the report"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Report video",
      preview: `Report video ${String(a["videoId"] ?? "").slice(0, 20)} for abuse`,
      confirmText: "Report",
    }),
  },
  {
    slug: "YOUTUBE_SET_COMMENT_MODERATION_STATUS",
    description:
      "Set moderation status for a YouTube comment. Requires user approval before it runs.",
    parameters: z
      .object({
        id: z.string().describe("Comment ID"),
        moderationStatus: z.enum(["published", "heldForReview", "rejected"]).describe("New moderation status"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Moderate comment",
      preview: `Set comment ${String(a["id"] ?? "").slice(0, 30)} to ${String(a["moderationStatus"] ?? "")}`,
      confirmText: "Set status",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "YOUTUBE_DELETE_CHANNEL_SECTION",
    description:
      "Permanently delete a channel section. Irreversible.",
    parameters: z
      .object({
        id: z.string().describe("Channel section ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete channel section",
      preview: `Permanently delete channel section ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Delete section",
    }),
  },
  {
    slug: "YOUTUBE_DELETE_COMMENT",
    description:
      "Permanently delete a YouTube comment. Irreversible.",
    parameters: z
      .object({
        id: z.string().describe("Comment ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete comment",
      preview: `Permanently delete comment ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Delete comment",
    }),
  },
  {
    slug: "YOUTUBE_DELETE_PLAYLIST",
    description:
      "Permanently delete a playlist and all its contents. Irreversible.",
    parameters: z
      .object({
        id: z.string().describe("Playlist ID to delete"),
        confirmDelete: z.coerce.boolean().describe("Must be true to confirm deletion"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete playlist",
      preview: `Permanently delete playlist ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Delete playlist",
    }),
  },
  {
    slug: "YOUTUBE_DELETE_PLAYLIST_ITEM",
    description:
      "Permanently remove a video from a playlist. Irreversible.",
    parameters: z
      .object({
        id: z.string().describe("Playlist item ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Remove from playlist",
      preview: `Permanently remove playlist item ${String(a["id"] ?? "").slice(0, 30)}`,
      confirmText: "Remove from playlist",
    }),
  },
  {
    slug: "YOUTUBE_DELETE_VIDEO",
    description:
      "Permanently delete a video from YouTube. Irreversible.",
    parameters: z
      .object({
        videoId: z.string().describe("Video ID to delete"),
        confirmDelete: z.coerce.boolean().describe("Must be true to confirm deletion"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete video",
      preview: `Permanently delete video ${String(a["videoId"] ?? "").slice(0, 20)}`,
      confirmText: "Delete video",
    }),
  },
]

export function makeComposioYouTubeDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "youtube",
    name: "YouTube",
    category: "communication",
    icon: "youtube",
    description: "Search, watch, comment, manage playlists, upload videos, and analyze channel data (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: YOUTUBE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_YOUTUBE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a YouTube auth config in Composio (uses Google OAuth2)",
        "Set COMPOSIO_API_KEY and COMPOSIO_YOUTUBE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=youtube to route YouTube through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_YOUTUBE_AUTH_CONFIG_ID", label: "Composio YouTube auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/youtube",
    },
    tools: createComposioTools({
      provider: "youtube",
      toolkit: YOUTUBE_TOOLKIT,
      specs: youtubeComposioSpecs,
      executor,
    }),
  }
}
