<p align="center">
  <img src="./assets/yomi-mark.png" alt="Yomi" width="120" height="120" />
</p>

<h1 align="center">Yomi</h1>

<p align="center">
  <strong>The AI assistant that lives in your Telegram.</strong>
</p>

<p align="center">
  <a href="https://t.me/yomi_assistant_bot">Try it on Telegram</a> ·
  <a href="https://getyomi.in">Website</a> ·
  <a href="https://getyomi.in/docs">Docs</a> ·
  <a href="https://getyomi.in/dashboard">Dashboard</a> ·
  <a href="./docs/README.md">Developer docs</a>
</p>

<p align="center">
  <a href="https://github.com/arka6fx/yomi/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/arka6fx/yomi/ci.yml?branch=main&style=flat-square&label=ci" alt="CI" /></a>
  <a href="https://github.com/arka6fx/yomi/releases"><img src="https://img.shields.io/github/v/release/arka6fx/yomi?style=flat-square&color=blue" alt="Release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license" /></a>
  <a href="https://t.me/yomi_assistant_bot"><img src="https://img.shields.io/badge/telegram-@yomi__assistant__bot-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

---

Text it, send a voice note, or snap a photo. Yomi reads your inbox, plans your
day, searches the web, and gets things done across the apps you already use, and
it always asks before it sends, books, pays, or deletes anything.

|                      |                                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| 💬 **Chat**          | Text, voice notes, and photos on Telegram. No new app to learn.                |
| 🔌 **Connectors**    | Gmail · Calendar · Drive · GitHub · Slack · Notion · Linear, plus dozens more. |
| ✅ **Approvals**     | Anything irreversible becomes a preview with Approve and Reject buttons.       |
| 🧠 **Memory**        | Remembers what matters to you. Yours to view, export, or delete.               |
| ⏰ **Routines**      | Morning briefs, inbox follow-ups, and weekly resets delivered on schedule.     |
| 🎭 **Characters**    | Text Gojo, Pikachu, Kratos and hundreds more, or make your own.                |
| 🖥️ **Computer**      | A private cloud browser Yomi drives; take over for logins, OTPs, and captchas. |
| 🔐 **Vault**         | Logins, cards, and addresses Yomi can use without ever seeing the raw secret.  |
| ✉️ **Email address** | Your own Yomi inbox for sign-ups, bookings, and receipts.                      |

---

<table>
<tr>
<td width="50%" valign="top">

<h3>🙋 I want to use Yomi</h3>

Open [@yomi_assistant_bot](https://t.me/yomi_assistant_bot) and say hi. There's no
sign-up: your first message creates your account. Connect your apps and manage
everything else from the [dashboard](https://getyomi.in/dashboard).

Free forever, with unlimited chat. **[→ See plans](https://getyomi.in/pricing)**

</td>
<td width="50%" valign="top">

<h3>🛠️ I want to build on Yomi</h3>

A FastAPI agent backend and a Next.js dashboard, running entirely on Cloudflare:
Containers, Workers AI, D1, Vectorize, and R2.

**[→ Run it locally](#quickstart)**

</td>
</tr>
</table>

---

## Quickstart

You need Node.js 22+ and [`uv`](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/arka6fx/yomi.git && cd yomi
npm install

cp apps/api/.env.example apps/api/.env          # add your Cloudflare values
cp apps/web/.env.example apps/web/.env.local

npm run python:dev                              # API       → localhost:8080
npm run dev --workspace @yomi/web               # dashboard → localhost:3000
```

Run the checks before opening a pull request:

```bash
npm run python:lint && npm run python:test
npm run lint && npm run typecheck && npm run test
```

## How it works

```text
Telegram ──► Cloudflare Worker ──► FastAPI container ──► Workers AI
                                       │    │
            D1 · Vectorize · R2  ◄─────┘    └────► Composio · Google · Computer sandbox

Dashboard (Next.js) ──► /api/* ──► FastAPI container
```

One Python backend owns everything: the Telegram gateway, the agent loop,
connectors, memory, billing, and auth. The dashboard never touches storage
directly. Read the full [architecture](./docs/architecture.md).

<details>
<summary><strong>Repository layout</strong></summary>

```text
apps/api        FastAPI backend, Cloudflare Workers, D1 migrations
apps/web        Next.js marketing site and dashboard
apps/sandbox    Computer-use desktop (Chrome in a Cloudflare Sandbox)
packages/       Shared TypeScript contracts, UI, and configs
docs/           Architecture, runbook, specs, and ADRs
```

</details>

<details>
<summary><strong>Tech stack</strong></summary>

|          |                                                                           |
| -------- | ------------------------------------------------------------------------- |
| Backend  | Python 3.11 · FastAPI · httpx                                             |
| Runtime  | Cloudflare Containers and Workers                                         |
| Storage  | Cloudflare D1 · Vectorize · R2                                            |
| Models   | Workers AI: `glm-5.3-flash`, `whisper-large-v3-turbo`, `bge-base-en-v1.5` |
| Web      | Next.js · React · Tailwind CSS                                            |
| Payments | Dodo Payments                                                             |

</details>

<details>
<summary><strong>Deployment</strong></summary>

Pushes to `main` deploy automatically: `apps/api` to `api.getyomi.in`,
`apps/web` to `getyomi.in`, and `apps/sandbox` to the computer gateway. D1
migrations and secrets are managed by hand. See the
[runbook](./docs/runbook.md).

</details>

## Contributing

Issues and ideas are welcome in
[GitHub Issues](https://github.com/arka6fx/yomi/issues). Read the
[contributing guide](./.github/CONTRIBUTING.md) before opening a pull request,
and report security issues privately as described in the
[security policy](./.github/SECURITY.md).

<p align="center">
  <sub>MIT licensed · Made by <a href="https://github.com/arka6fx">Arka Garai</a> and contributors</sub>
</p>
