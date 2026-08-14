// Per-connector example prompts shown once a connector is connected — on its
// dashboard card (packages/ui-connectors) and in the proactive Telegram nudge
// (apps/backend/src/services/connector-nudge.ts). Phrased as outcomes the user
// can paste verbatim into Telegram, never as feature descriptions — an example
// that only makes sense in the abstract reads as marketing, not something the
// user can run right now. Keyed by connector id, matching
// packages/ui-connectors/src/catalog.ts's CATALOG_DEFS ids. Covers every
// connector with available: true there (swiggy is available: false and
// excluded).
export const STARTER_PROMPTS: Record<string, string[]> = {
  google: ["Draft a reply to the last email from Sam", "Tell me when I get an email from my boss"],
  "google-calendar": [
    "Find a 30-minute slot this week for a call with Sam",
    "Let me know if I have back-to-back meetings tomorrow",
  ],
  "google-drive": [
    "Find the latest version of the Q3 budget spreadsheet",
    "Tell me when someone shares a new file with me",
  ],
  "google-docs": [
    "Turn my meeting notes into a formatted Google Doc",
    "Summarize the doc I'm working on into three bullet points",
  ],
  "google-maps": [
    "Find coffee shops within 10 minutes of my next meeting",
    "What's the best-rated Italian place near downtown?",
  ],
  "google-sheets": [
    "Add this week's expenses to my budget spreadsheet",
    "Summarize the totals in row 20 of my tracker sheet",
  ],
  "google-slides": [
    "Turn my notes into a 5-slide deck",
    "Add a slide summarizing last quarter's results",
  ],
  "google-classroom": [
    "Tell me what assignments are due this week",
    "Summarize the latest announcement in my Biology class",
  ],
  "google-tasks": [
    "Add 'renew passport' to my to-do list",
    "Tell me what's still open on my task list today",
  ],
  "google-meet": [
    "Set up a meeting link for tomorrow's standup",
    "Summarize the transcript from yesterday's call",
  ],
  notion: ["Summarize this week's meeting notes", "Tell me when the roadmap page changes"],
  github: ["Summarize open issues labeled bug", "Tell me when a PR is opened against main"],
  slack: ["Summarize unread messages in #general", "Notify me when someone mentions me"],
  linear: ["Summarize what's in progress on my team", "Tell me when a P0 issue is created"],
  hubspot: ["Summarize this week's new contacts", "Tell me when a new deal moves to negotiation"],
  discord: [
    "Tell me who joined my server this week",
    "Summarize the last 20 messages in #announcements",
  ],
  firecrawl: [
    "Scrape the pricing page of my competitor's site",
    "Extract every article title from this blog's homepage",
  ],
  linkedin: ["Draft a post announcing our new feature", "Summarize the comments on my latest post"],
  outlook: ["Summarize my meetings for tomorrow", "Tell me when I get an email from my manager"],
  whatsapp: [
    "Send today's order confirmation template to a customer",
    "Notify me when a customer replies on WhatsApp",
  ],
  jira: ["Summarize what's in this sprint", "Tell me when a critical bug is filed"],
  reddit: ["Find the top posts in r/technology today", "Notify me when someone replies to my post"],
  todoist: ["Add 'call the dentist' to my personal list", "Tell me what's overdue on my task list"],
  figma: [
    "List the components in my design system file",
    "Summarize the latest comments on my mockup",
  ],
  zoom: [
    "Schedule a Zoom call for Thursday at 3pm",
    "Summarize the recording from yesterday's meeting",
  ],
  salesforce: [
    "Summarize this week's new leads",
    "Tell me when an opportunity moves to Closed Won",
  ],
  instagram: ["Draft a caption for my next product post", "Summarize comments on my latest post"],
  facebook: [
    "Schedule a post for my Page tomorrow morning",
    "Summarize messages waiting in my Page inbox",
  ],
  calendly: [
    "Tell me about my bookings for tomorrow",
    "Check my availability for a call this week",
  ],
  trello: ["Add a card to my Sprint board", "Summarize what's in the 'In Progress' list"],
  "one-drive": [
    "Find the latest version of the proposal doc",
    "Tell me when a file is shared with me",
  ],
  posthog: ["Summarize this week's signup funnel", "Tell me if there's a spike in errors today"],
  attio: ["Summarize notes on my last call with a lead", "Tell me when a deal moves stage"],
  dropbox: [
    "Find the latest file in my shared folder",
    "Tell me when someone uploads to my team folder",
  ],
  "microsoft-teams": [
    "Summarize unread messages in my project channel",
    "Tell me about my meetings today",
  ],
  gumroad: ["Tell me about today's sales", "Summarize this week's refund requests"],
  miro: ["Summarize the sticky notes on my brainstorm board", "Add a card to my retro board"],
  mem0: [
    "Remember that I prefer async standups",
    "What do you remember about my project preferences?",
  ],
  zoho: ["Summarize this week's new deals", "Tell me when a lead is assigned to me"],
  serpapi: [
    "Search for the latest news on AI regulation",
    "Find the top 5 results for 'best CRM 2026'",
  ],
  "dynamics-365": ["Summarize this week's new accounts", "Tell me when an opportunity is updated"],
  exa: [
    "Find recent research papers on transformer efficiency",
    "Search for companies similar to mine",
  ],
  youtube: ["Summarize the top comments on my latest video", "Find trending videos in my niche"],
  asana: ["Add a task to my Sprint project", "Tell me what's overdue on my project"],
  stripe: ["Tell me about today's revenue", "Notify me when a payment fails"],
  supabase: ["List the storage buckets in my project", "Check if my edge function is deployed"],
  vercel: [
    "Check the status of my production deployment",
    "Tell me when my latest deployment finishes",
  ],
  cloudflare: ["List the zones on my Cloudflare account", "Show me the firewall rules on my zone"],
  "zoho-invoice": ["Summarize this week's paid invoices", "Tell me when an invoice is overdue"],
  neon: ["List my project's branches", "Show me recent operations on my project"],
  fireflies: [
    "Summarize my last recorded meeting",
    "Tell me the action items from yesterday's call",
  ],
  "google-ads": [
    "Summarize this week's campaign performance",
    "Tell me if my cost-per-click spiked today",
  ],
  "google-analytics": [
    "Summarize this week's site traffic",
    "Tell me which page had the most visitors yesterday",
  ],
  "google-search-console": [
    "Tell me if my site's search impressions dropped this week",
    "Summarize my top 5 search queries this month",
  ],
  "google-cloud-vision": [
    "Extract the text from this receipt photo",
    "Tell me what's in this image",
  ],
  kaggle: [
    "Find datasets about customer churn",
    "Summarize the top notebooks for this competition",
  ],
  context7: [
    "Look up the latest docs for the Next.js App Router",
    "Find a code example for Stripe's webhook API",
  ],
}
