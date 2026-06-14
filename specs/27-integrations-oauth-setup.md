# 27 — Connector implementation audit

## Pre-existing test failure

| File | Issue | Status |
| ---- | ----- | ------ |
| `gateway-runner.test.ts` | `SyntaxError: Export named 'mcpConnections' not found` | Pre-existing, unrelated to connector work — no regressions |

---

## Notion connector — functional gaps

Notion OAuth wired end-to-end (env vars, backend routes, token encryption, frontend UI).
Only the tools and connector metadata need updating.

| Item | Status | Detail | File |
| ---- | ------ | ------ | ---- |
| `readOnlyByDefault` | ⚠️ Set to `true` | Should flip to `false` (Notion integration has write caps) | `notion-def.ts:186` |
| `notion.createPage` | ❌ Missing | Create a page in a Notion database | `notion-def.ts` |
| `notion.updatePage` | ❌ Missing | Update page properties | `notion-def.ts` |
| `notion.createDatabaseEntry` | ❌ Missing | Create a row in a database | `notion-def.ts` |
| `description` | ⚠️ Read-only | Currently "Search pages, read content" — should mention create/update | `notion-def.ts:185` |
| `setup.steps` | ⚠️ Partial | Only mentions "Read content" — should list all enabled capabilities | `notion-def.ts:200-205` |

---

## Slack audit

| Area | Status | Detail | Tests |
| ---- | ------ | ------ | ----- |
| OAuth routes | ✅ Implemented | Generic `oauth2-executor.ts` — auth URL, callback, token exchange | 1-3 pass |
| Callback handling | ✅ Implemented | `handleOAuth2Callback` — code exchange, token storage, redirect | 1-3 pass |
| Token storage | ✅ Implemented | AES-256-GCM encrypted at rest, `mcp_connections` table | 1-3 pass |
| Slack API client | ✅ Implemented | `slack<T>()` helper in `createSlackTools` — Bearer auth, error handling | 4-5 pass |
| Channel listing | ✅ Implemented | `slack.listChannels` — paginated, excludes archived | 6-7 pass |
| **User listing** | ✅ **Built** | `slack.listUsers` — id, name, displayName, avatar; filters bots + deleted | **10-11 pass** |
| Message sending | ✅ Implemented | `slack.sendMessage` — channel or DM, mrkdwn formatting | 12 pass |

**14/14 Slack tests pass.** Only `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` env values needed to go live.

---

## GitHub audit

| Area | Status | Detail | Tests |
| ---- | ------ | ------ | ----- |
| OAuth env vars | ✅ Implemented | `GITHUB_INTEGRATIONS_CLIENT_ID` / `SECRET` wired in all 3 envs | 1-3 pass |
| Connector def | ✅ Implemented | `githubDef` with scopes `repo`, `read:user`, redirect `/callback/github` | 4-5 pass |
| Display name | ✅ Implemented | Fetches from `api.github.com/user` | 6-8 pass |
| PR listing | ✅ Implemented | `github.listPRs` — state filter, pagination | 9-10, 14-16 pass |
| PR details | ✅ Implemented | `github.getPR` — stats, description, review status | 11 pass |
| Issue listing | ✅ Implemented | `github.listIssues` — state/label filter, excludes PRs | 12 pass |
| Issue details | ✅ Implemented | `github.getIssue` — body, comments, labels | 13 pass |

**16/16 GitHub tests pass.** `GITHUB_INTEGRATIONS_CLIENT_ID` / `SECRET` already filled.

---

## Linear audit

| Area | Status | Detail | Tests |
| ---- | ------ | ------ | ----- |
| OAuth env vars | ✅ Implemented | `LINEAR_CLIENT_ID` / `SECRET` wired in all 3 envs | 1 pass |
| Connector def | ✅ Implemented | `linearDef` with scopes `read`, `write`, redirect `/callback/linear` | 2-3 pass |
| Display name | ✅ Implemented | Fetches from Linear GraphQL `viewer` query | 4-5 pass |
| Issue listing | ✅ Implemented | `linear.listIssues` — filter by team/assignee/state/pagination | 6-7 pass |
| Issue details | ✅ Implemented | `linear.getIssue` — description, comments, assignee | 8 pass |
| Issue creation | ✅ Implemented | `linear.createIssue` — resolves team, sets priority | 9 pass |
| Issue update | ✅ Implemented | `linear.updateIssue` — state, priority changes | 10 pass |
| Tools auth | ✅ Implemented | Bearer token from `getAccessToken` | 11 pass |

**11/11 Linear tests pass.** All env vars filled. No gaps.

---

## Discord connector — not implemented

Discord has a messaging gateway (bot-based, hidden from public UI) but zero connector code in the integrations framework. Needs full build from scratch.

| Item | Status | Detail | File |
| ---- | ------ | ------ | ---- |
| `discord-def.ts` | ❌ Missing | Connector def with OAuth config, scopes, tools | `packages/agent-core/src/connectors/` |
| `catalog.ts` entry | ❌ Missing | No catalog entry for Discord | `packages/ui-connectors/src/catalog.ts` |
| OAuth env vars | ✅ Wired | `DISCORD_INTEGRATIONS_CLIENT_ID` / `SECRET` in all 3 envs | `.env`, `.env.production`, `apps/backend/.env` |
| Discord app redirects | ❌ Not added | Need to add `/api/integrations/callback/discord` to dev portal | Discord Developer Portal → OAuth2 |
| Backend def | ❌ Missing | `apps/backend/src/connectors/defs/discord.ts` | To be created |
| Tools | ❌ Missing | No tools built yet | To be created |
| Tests | ❌ Missing | No test file | To be created |

### OAuth scopes — TBD

Minimum viable scopes to decide:
- `identify` — display name, avatar
- `guilds` — list servers the user is in
- `guilds.channels.read` — list channels (optional, for channel listing tool)
- `guilds.members.read` — read member lists (only if `listMembers` tool needed)

`guilds.members.read` is **not required** unless a member listing tool is planned.
