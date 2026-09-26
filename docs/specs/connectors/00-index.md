# Connectors

This folder tracks the connector surface area that Yomi exposes to the agent
loop. Each connector spec lists the current tool names, read/write behavior,
auth requirements, and known gaps.

Runtime definitions live in the Python backend under
`apps/api/src/yomi/connectors/` (first-class tool sets; port in progress).
Dashboard display metadata is cataloged in
`packages/ui/src/catalog.ts`.

## First-class connectors

These have hand-written runtime definitions with curated tool sets and, in most
cases, a dedicated spec in this folder.

| Connector        | Runtime id         | Spec                  | Tools | Status                                   |
| ---------------- | ------------------ | --------------------- | ----: | ---------------------------------------- |
| Google Gmail     | `google`           | `google-gmail.md`     |    20 | Implemented                              |
| Google Calendar  | `google-calendar`  | `google-calendar.md`  |    10 | Implemented                              |
| Google Drive     | `google-drive`     | `google-drive.md`     |    19 | Implemented                              |
| Google Classroom | `google-classroom` | `google-classroom.md` |     7 | Implemented, read-write (gated writes)   |
| Google Tasks     | `google-tasks`     | `google-tasks.md`     |     6 | Implemented                              |
| Google Meet      | `google-meet`      | `google-meet.md`      |     7 | Implemented                              |
| GitHub           | `github`           | `github.md`           |    23 | Implemented                              |
| Notion           | `notion`           | `notion.md`           |    12 | Implemented                              |
| Slack            | `slack`            | `slack.md`            |     9 | Implemented                              |
| Linear           | `linear`           | `linear.md`           |    12 | Implemented                              |

## Composio-backed connectors

These share a single integration pattern: tools are resolved through Composio's
unified executor and wrapped by the same approval gate as first-class writes.
They have no per-connector spec — the Composio toolkit is the source of truth
for their action list. The Python port wraps the same Composio toolkit under
`apps/api/src/yomi/connectors/`.

| Connector             | Runtime id              | Connector    | Runtime id     |
| --------------------- | ----------------------- | ------------ | -------------- |
| Google Docs           | `google-docs`           | Miro         | `miro`         |
| Google Sheets         | `google-sheets`         | Dynamics 365 | `dynamics-365` |
| Google Slides         | `google-slides`         | SerpApi      | `serpapi`      |
| Google Maps           | `google-maps`           | Exa          | `exa`          |
| Google Photos         | `google-photos`         | Mem0         | `mem0`         |
| Google Ads            | `google-ads`            | Cloudflare   | `cloudflare`   |
| Google Analytics      | `google-analytics`      | Vercel       | `vercel`       |
| Google Search Console | `google-search-console` | Supabase     | `supabase`     |
| Google Cloud Vision   | `google-cloud-vision`   | Stripe       | `stripe`       |
| HubSpot               | `hubspot`               | Neon         | `neon`         |
| Salesforce            | `salesforce`            | Zoho CRM     | `zoho`         |
| Attio                 | `attio`                 | Zoho Invoice | `zoho-invoice` |
| Firecrawl             | `firecrawl`             | Gumroad      | `gumroad`      |
| Discord               | `discord`               | Fireflies    | `fireflies`    |
| WhatsApp              | `whatsapp`              | Kaggle       | `kaggle`       |
| LinkedIn              | `linkedin`              | Context7     | `context7`     |
| Outlook               | `outlook`               | Todoist      | `todoist`      |
| Microsoft Teams       | `microsoft-teams`       | Reddit       | `reddit`       |
| OneDrive              | `one-drive`             | Jira         | `jira`         |
| Dropbox               | `dropbox`               | Asana        | `asana`        |
| Figma                 | `figma`                 | Trello       | `trello`       |
| YouTube               | `youtube`               | Calendly     | `calendly`     |
| Zoom                  | `zoom`                  | PostHog      | `posthog`      |
| Facebook              | `facebook`              | Instagram    | `instagram`    |

## Confirmation rule

Tools that create, update, send, delete, merge, archive, or otherwise mutate
user data must require confirmation before the mutation. Prefer the shared
pending-action gate where available; otherwise the tool must block until an
explicit confirmation argument is supplied.

The desktop client and its sidecar are retired (see
`docs/adr/0002-retire-desktop-telegram-only.md`) — Telegram is the only
interaction surface now. `gateWrite()` gates writes backend-side via
`apps/api/src/services/pending-actions.ts`. Approval synonyms ("yes",
"/approve", …) are intercepted before intent routing and replay the stored tool
call.
