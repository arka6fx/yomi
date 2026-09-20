import type { ConnectorInfo, ConnectorCategory } from "./types.js"
import { STARTER_PROMPTS } from "@yomi/shared/starter-prompts"

// Static connector catalog — no Node.js dependencies, safe for browser bundles.
// The only in-tree connector registry; runtime defs are being ported to Python
// (apps/backend/src/yomi/connectors).
const CATALOG_DEFS: Array<{
  id: string
  name: string
  description: string
  category: ConnectorCategory
  authKind: "oauth2" | "composio" | "api_key" | "connection_string"
  icon: string
  available: boolean
}> = [
  {
    id: "google",
    name: "Gmail",
    description: "Read, search, summarize, and send email with approval.",
    category: "email",
    authKind: "composio",
    icon: "mail",
    available: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read events and schedule meetings with approval.",
    category: "productivity",
    authKind: "composio",
    icon: "calendar",
    available: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Search, read, create, edit, and delete your Drive files.",
    category: "productivity",
    authKind: "composio",
    icon: "cloud",
    available: true,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Create and edit richly formatted Google Docs from Markdown.",
    category: "productivity",
    authKind: "composio",
    icon: "file-text",
    available: true,
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Search for places and businesses near a location.",
    category: "productivity",
    authKind: "composio",
    icon: "map-pin",
    available: true,
  },
  {
    id: "google-photos",
    name: "Google Photos",
    description:
      "Unavailable: Google restricts the required Photos Library access for this connector.",
    category: "productivity",
    authKind: "composio",
    icon: "google-photos",
    available: false,
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, create, and edit spreadsheets — rows, formulas, and charts.",
    category: "productivity",
    authKind: "composio",
    icon: "table",
    available: true,
  },
  {
    id: "google-slides",
    name: "Google Slides",
    description: "Build multi-slide presentations from Markdown and edit existing decks.",
    category: "productivity",
    authKind: "composio",
    icon: "presentation",
    available: true,
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Read your classes, assignments, due dates, announcements, and grades.",
    category: "productivity",
    authKind: "composio",
    icon: "graduation-cap",
    available: true,
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    description: "Read your to-do lists and create, edit, or complete tasks with approval.",
    category: "productivity",
    authKind: "composio",
    icon: "list-checks",
    available: true,
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Create meeting links and read past calls, attendees, and transcripts.",
    category: "meetings",
    authKind: "composio",
    icon: "video",
    available: true,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search pages and query databases in your workspace.",
    category: "productivity",
    authKind: "composio",
    icon: "file-text",
    available: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repositories, issues, pull requests, and code.",
    category: "developer",
    authKind: "composio",
    icon: "github",
    available: true,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search channels and send messages with approval.",
    category: "communication",
    authKind: "composio",
    icon: "message-square",
    available: true,
  },
  {
    id: "linear",
    name: "Linear",
    description: "Search issues, create tasks, and manage project work.",
    category: "productivity",
    authKind: "composio",
    icon: "list-checks",
    available: true,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Manage contacts, deals, companies, tickets, and products in HubSpot CRM.",
    category: "crm",
    authKind: "composio",
    icon: "hubspot",
    available: true,
  },
  {
    id: "discord",
    name: "Discord",
    description: "List servers, get member info, resolve invites, and manage your profile.",
    category: "communication",
    authKind: "composio",
    icon: "discord",
    available: true,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "Search, scrape, crawl, and extract structured data from the web.",
    category: "data",
    authKind: "composio",
    icon: "firecrawl",
    available: true,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description:
      "Post updates, share articles, comment on posts, and read your profile and company pages.",
    category: "communication",
    authKind: "composio",
    icon: "linkedin",
    available: true,
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Read and send email, manage calendar events and contacts via Microsoft Outlook.",
    category: "email",
    authKind: "composio",
    icon: "outlook",
    available: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description:
      "WhatsApp Business Account only (not a personal number) — send messages, media, and templates.",
    category: "communication",
    authKind: "composio",
    icon: "whatsapp",
    available: true,
  },
  {
    id: "jira",
    name: "Jira",
    description: "Manage issues, projects, sprints, and workflows in Jira.",
    category: "developer",
    authKind: "composio",
    icon: "jira",
    available: true,
  },
  {
    id: "reddit",
    name: "Reddit",
    description: "Browse subreddits, search content, create posts, and manage comments.",
    category: "communication",
    authKind: "composio",
    icon: "reddit",
    available: true,
  },
  {
    id: "todoist",
    name: "Todoist",
    description:
      "Create, read, update, and manage tasks, projects, sections, labels, and comments.",
    category: "productivity",
    authKind: "composio",
    icon: "list-checks",
    available: true,
  },
  {
    id: "figma",
    name: "Figma",
    description:
      "Browse designs, extract components and design tokens, manage comments, and render assets.",
    category: "other",
    authKind: "composio",
    icon: "figma",
    available: true,
  },
  {
    id: "zoom",
    name: "Zoom",
    description:
      "Schedule and manage meetings, webinars, recordings, whiteboards, and user settings.",
    category: "meetings",
    authKind: "composio",
    icon: "zoom",
    available: true,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description:
      "Manage Salesforce CRM — accounts, contacts, leads, opportunities, campaigns, tasks, and SOQL queries.",
    category: "crm",
    authKind: "composio",
    icon: "salesforce",
    available: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    description:
      "Instagram Business or Creator account linked to a Facebook Page — media, comments, DMs, analytics, and publishing.",
    category: "communication",
    authKind: "composio",
    icon: "instagram",
    available: true,
  },
  {
    id: "facebook",
    name: "Facebook",
    description:
      "Manage Facebook Pages — posts, comments, messages, photos, videos, insights, and page settings.",
    category: "communication",
    authKind: "composio",
    icon: "facebook",
    available: true,
  },
  {
    id: "calendly",
    name: "Calendly",
    description:
      "Schedule meetings, manage event types, check availability, handle invites, and configure webhooks.",
    category: "meetings",
    authKind: "composio",
    icon: "calendly",
    available: true,
  },
  {
    id: "trello",
    name: "Trello",
    description: "Manage boards, lists, cards, checklists, labels, and team workflows in Trello.",
    category: "productivity",
    authKind: "composio",
    icon: "trello",
    available: true,
  },
  {
    id: "one-drive",
    name: "OneDrive",
    description:
      "Microsoft OneDrive — store, sync, and share files; manage folders, permissions, sharing links, version history, and Excel workbooks.",
    category: "productivity",
    authKind: "composio",
    icon: "one-drive",
    available: true,
  },
  {
    id: "posthog",
    name: "PostHog",
    description:
      "PostHog — product analytics, feature flags, session recordings, funnels, event tracking, and data insights.",
    category: "data-analytics",
    authKind: "composio",
    icon: "posthog",
    available: true,
  },
  {
    id: "attio",
    name: "Attio",
    description:
      "Attio — modern CRM for relationship-driven businesses; manage contacts, deals, notes, tasks, lists, and custom objects.",
    category: "crm",
    authKind: "composio",
    icon: "attio",
    available: true,
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description:
      "Dropbox — cloud file storage and sharing; manage files, folders, sharing, and team admin.",
    category: "file-management",
    authKind: "composio",
    icon: "dropbox",
    available: true,
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    description:
      "Microsoft Teams — team chat and collaboration; manage channels, chats, members, meetings, shifts, teams, presence, and scheduling.",
    category: "communication",
    authKind: "composio",
    icon: "microsoft-teams",
    available: true,
  },
  {
    id: "gumroad",
    name: "Gumroad",
    description:
      "Gumroad — sell digital products; manage products, sales, licenses, and webhook subscriptions.",
    category: "other",
    authKind: "composio",
    icon: "gumroad",
    available: true,
  },
  {
    id: "miro",
    name: "Miro",
    description:
      "Miro — collaborative whiteboard platform; create and manage boards, cards, sticky notes, shapes, connectors, and tags.",
    category: "productivity",
    authKind: "composio",
    icon: "miro",
    available: true,
  },
  {
    id: "mem0",
    name: "Mem0",
    description:
      "Mem0 — intelligent memory layer for AI agents; store, search, retrieve, and manage memories, entities, organizations, and projects.",
    category: "data",
    authKind: "composio",
    icon: "mem0",
    available: true,
  },
  {
    id: "zoho",
    name: "Zoho CRM",
    description:
      "Zoho CRM — cloud-based CRM platform; manage accounts, contacts, leads, deals, tasks, events, notes, and custom modules.",
    category: "crm",
    authKind: "composio",
    icon: "zoho",
    available: true,
  },
  {
    id: "serpapi",
    name: "SerpApi",
    description:
      "SerpApi — real-time search engine results API; search the web, news, images, shopping, local listings, academic articles, and more across Google, Bing, Yahoo, and other engines.",
    category: "data",
    authKind: "composio",
    icon: "serpapi",
    available: true,
  },
  {
    id: "dynamics-365",
    name: "Dynamics 365",
    description:
      "Microsoft Dynamics 365 CRM — manage accounts, contacts, leads, opportunities, campaigns, quotes, sales orders, and invoices.",
    category: "crm",
    authKind: "composio",
    icon: "dynamics-365",
    available: true,
  },
  {
    id: "exa",
    name: "Exa",
    description:
      "AI-powered web search and data extraction — search, answer, find similar content, monitor URLs, and research.",
    category: "data",
    authKind: "composio",
    icon: "exa",
    available: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    description:
      "Search, watch, comment, manage playlists, upload videos, and analyze channel data.",
    category: "communication",
    authKind: "composio",
    icon: "youtube",
    available: true,
  },
  {
    id: "asana",
    name: "Asana",
    description: "Manage tasks, projects, sections, tags, and teams in Asana.",
    category: "productivity",
    authKind: "composio",
    icon: "asana",
    available: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    description:
      "Stripe — payment processing, subscriptions, invoices, billing, and financial operations.",
    category: "finance",
    authKind: "composio",
    icon: "stripe",
    available: true,
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "Supabase — open-source backend-as-a-service: Postgres database, auth, storage, edge functions, and real-time APIs.",
    category: "developer",
    authKind: "composio",
    icon: "supabase",
    available: true,
  },
  {
    id: "vercel",
    name: "Vercel",
    description:
      "Vercel — frontend deployment platform: projects, deployments, domains, edge config, environment variables, and team management.",
    category: "developer",
    authKind: "composio",
    icon: "vercel",
    available: true,
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description:
      "Cloudflare — DNS management, WAF, zones, tunnels, load balancers, bot management, and account administration.",
    category: "developer",
    authKind: "composio",
    icon: "cloudflare",
    available: true,
  },
  {
    id: "zoho-invoice",
    name: "Zoho Invoice",
    description:
      "Zoho Invoice — billing and invoicing platform: estimates, invoices, credit notes, expenses, projects, and payments.",
    category: "finance",
    authKind: "composio",
    icon: "zoho-invoice",
    available: true,
  },
  {
    id: "neon",
    name: "Neon",
    description:
      "Serverless Postgres with branching, point-in-time restore, and connection pooling.",
    category: "developer",
    authKind: "composio",
    icon: "neon",
    available: true,
  },
  {
    id: "fireflies",
    name: "Fireflies",
    description: "AI meeting assistant that records, transcribes, and summarizes meetings.",
    category: "meetings",
    authKind: "composio",
    icon: "fireflies",
    available: true,
  },
  {
    id: "google-ads",
    name: "Google Ads",
    description: "Manage and analyze ad campaigns, keywords, ad groups, and performance metrics.",
    category: "data-analytics",
    authKind: "composio",
    icon: "google-ads",
    available: true,
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description:
      "Web and app analytics for traffic, engagement, conversions, and audience insights.",
    category: "data-analytics",
    authKind: "composio",
    icon: "google-analytics",
    available: true,
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    description:
      "Monitor and optimize your site's search performance, index coverage, and sitemaps.",
    category: "data-analytics",
    authKind: "composio",
    icon: "google-search-console",
    available: true,
  },
  {
    id: "google-cloud-vision",
    name: "Google Cloud Vision",
    description:
      "Image analysis and recognition: OCR, object/face/landmark detection, safe search, and web entities.",
    category: "data",
    authKind: "composio",
    icon: "google-cloud-vision",
    available: true,
  },
  {
    id: "kaggle",
    name: "Kaggle",
    description:
      "Discover datasets, participate in competitions, and explore ML models and notebooks.",
    category: "data",
    authKind: "composio",
    icon: "kaggle",
    available: true,
  },
  {
    id: "context7",
    name: "Context7",
    description:
      "Up-to-date library documentation for AI coding assistants; query APIs, code examples, and version-specific docs.",
    category: "developer",
    authKind: "api_key",
    icon: "context7",
    available: true,
  },
]

// displayNames maps connector id → the account it is bound to (usually an email).
// Each connector is its own OAuth grant, so they can legitimately sit on different
// Google accounts — showing the account is the only way a user can tell.
export function buildCatalog(
  connectedProviders: string[] = [],
  displayNames: Record<string, string> = {},
): ConnectorInfo[] {
  const connectedSet = new Set(connectedProviders)
  return CATALOG_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    authKind: def.authKind,
    icon: def.icon,
    available: def.available,
    connected: connectedSet.has(def.id),
    displayName: displayNames[def.id],
    starterPrompts: STARTER_PROMPTS[def.id] ?? [],
  }))
}
