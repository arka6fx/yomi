# Composio as a connector/auth layer for Yomi

Date: 2026-07-18 · Author: background research agent

Evaluation of [Composio](https://composio.dev) ([docs](https://docs.composio.dev))
as an auth/token layer and/or tool provider for Yomi's connectors, judged against
the team's rule — "no new managed vendors, no new orchestrator" — and Yomi's three
hard constraints (Google CASA, the privacy promise, vendor cost/lock-in).

## TL;DR verdict

- **Does not remove the CASA burden.** Google requires the annual security
  assessment for any app that accesses restricted data "from or through a
  third-party server." Routing `gmail.modify` data through Composio's cloud is
  exactly that path — it keeps the assessment and can *widen* its scope to
  include Composio. Composio changes nothing here in Yomi's favour.
- **Contradicts the privacy promise as used by default.** In Composio's default
  managed flow, tokens are captured and stored on Composio's cloud and tool
  request/response payloads (i.e. Gmail/Drive content) execute *through* Composio
  servers. Yomi's policy says user data is "never shared with any third party
  except the AI inference provider." Composio would be a second third party.
- **No self-serve self-hosting.** The SDKs are MIT-licensed, but the runtime that
  stores credentials and executes tools is proprietary; self-hosting/VPC is an
  Enterprise (sales-gated) option. There is no free/OSS way to keep data in
  Yomi's own infra.
- **It's a genuinely good product for the problem it solves** — broad toolkit
  coverage (all of Yomi's connectors exist), clean Vercel-AI-SDK integration,
  managed OAuth/refresh — but that value is aimed at teams that *don't* already
  have hand-rolled connectors and *don't* have a privacy promise to keep.
- **Recommendation:** **Do not adopt for production Google (restricted-scope)
  connectors.** Marginal, conditional value for **non-Google** connectors only if
  Yomi uses a **custom (own-OAuth) auth config** — and even then execution data
  still transits Composio unless tokens are pulled back out. Fine as a
  **dev/testing convenience** to prototype a new connector before hand-rolling
  it. Net: it violates two of the three constraints; **pass** for the core use.

## What Composio is

Composio is an integration platform for AI agents that bundles two things:
managed **authentication** (OAuth/API-key connection flows, token storage and
refresh) and a **tool catalog** (typed actions per provider). Core nouns:
*toolkits* (a provider, e.g. GitHub), *tools/actions* (`GITHUB_CREATE_ISSUE`),
*auth configs* (credential setup), and *connected accounts* (a specific user's
authenticated instance). Tools are exposed to an agent either as native
framework tools (a provider package) or via MCP.
[[overview]](https://docs.composio.dev)

## Auth model: managed vs. custom

Composio ships a **default developer OAuth app** ("managed auth") so you can
connect without registering your own OAuth client. For production it explicitly
recommends the opposite: *"We recommend using your own developer app for the
OAuth2 scheme as it is more suited for production usage with many users and more
granular control over scopes."*
[[custom auth configs]](https://docs.composio.dev/docs/custom-auth-configs)

Consent-screen branding follows from that choice. With the managed app the
consent screen and connect pages read "Composio"; to show Yomi's own name you
must create a custom auth config with your own OAuth credentials. Composio's
white-labeling covers four surfaces — the Connect Link page, the OAuth consent
screen, browser redirects, and the post-auth success page — and the consent-screen
fix is specifically *"create a custom auth config with your own OAuth credentials
and pass that auth config when creating a session."*
[[white-labeling]](https://docs.composio.dev/docs/white-labeling)

Practical implication for Yomi: for restricted Google scopes you would **have to**
bring your own OAuth client (Yomi's, the one already mid-verification) — the
managed Composio app is not a viable production consent surface. So Composio does
not save Yomi the Google Cloud OAuth-app/verification work; that stays with Yomi.

## Where tokens and data live

By default, connected-account credentials are **stored on Composio's cloud**: the
OAuth callback registered with the provider is Composio's, so Composio receives
and persists the tokens. Token fields (`access_token`, `refresh_token`, `api_key`,
…) are **masked** in API responses by default (first 4 chars + ellipsis), and
masking can be disabled per-project if you need full values for your own calls.
[[connected accounts]](https://docs.composio.dev/docs/auth-configuration/connected-accounts)

Tool **execution** also runs through Composio. The Vercel AI SDK provider
(`@composio/vercel`) returns tools whose `execute` function calls Composio's API —
*"tools include an `execute` function, so the AI SDK handles tool calls
automatically."* That means the request arguments and the provider's response
(Gmail message bodies, Drive file content) pass **through Composio's servers**, not
just the tokens. [[vercel provider]](https://docs.composio.dev/providers/vercel)

There is a narrow path to keep raw execution in Yomi's own process: with a
**custom auth config (your own OAuth app)**, tokens issued against your OAuth
client belong to you and can be read back (masking disabled), so Yomi could pull
the access token and call Google directly — bypassing Composio's execution path.
Composio-managed tokens, by contrast, are redacted specifically to prevent this.
[[connected accounts]](https://docs.composio.dev/docs/auth-configuration/connected-accounts)
But at that point Composio is only a token vault that still saw the OAuth grant —
Yomi already has an encrypted-at-rest token vault in its own Neon DB, so this
mode buys almost nothing while still introducing the vendor.

## Security & compliance posture

Composio's privacy policy states *"Advanced encryption for data in transit and at
rest"* and, for Google data, *"We do not share, transfer, or disclose Google user
data to any third parties, except as strictly necessary for providing our
platform's core functionality."* The public policy does **not** enumerate token
storage specifics, subprocessors, data residency, or name SOC 2/ISO on that page.
[[privacy]](https://composio.dev/privacy) SOC 2 and VPC/on-prem appear only as
**Enterprise-tier** line items on the pricing page (below).
[[pricing]](https://composio.dev/pricing)

Note the policy's own carve-out — data may be used "as strictly necessary for
providing our platform's core functionality" — is *broader* than Yomi's promise
("never shared with any third party except the AI inference provider"). Adopting
Composio would require rewording Yomi's privacy policy to name Composio as a data
processor.

## Self-hosting / open-source status

Composio publishes MIT-licensed **SDKs**, but the credential-storing runtime and
tool-execution backend are proprietary and hosted. Self-hosting is not a
documented self-serve feature: the community "self hosting" GitHub discussion
(#1037) has **no maintainer answer**, and VPC/On-Prem is listed only under the
sales-gated Enterprise tier.
[[self-hosting discussion]](https://github.com/ComposioHQ/composio/discussions/1037)
[[pricing]](https://composio.dev/pricing) So there is no free path to run Composio
inside Yomi's EC2/Neon perimeter and satisfy the privacy constraint by
construction.

## Pricing & lock-in

From the pricing page (with a note that **pricing changes on Aug 15**):
[[pricing]](https://composio.dev/pricing)

| Tier | Price | Included | Overage | Support |
| --- | --- | --- | --- | --- |
| Free | $0/mo | 20K tool calls/mo | — | Community |
| Ridiculously Cheap | $29/mo | 200K tool calls/mo | $0.299 / 1K | Email |
| Serious Business | $229/mo | 2M tool calls/mo | $0.249 / 1K | Slack |
| Enterprise | custom | custom volume | — | Dedicated SLA, **SOC-2**, **VPC/On-Prem** |

Billing is **per tool call**, which maps poorly onto Yomi's own credit model
(agent run 3, Telegram message 3) — a single agent turn can fan out to many
Composio tool calls, so cost is a moving multiple of user activity. The
compliance/self-host features Yomi actually needs sit behind the Enterprise
(negotiated) tier. This is a textbook "new managed vendor" the stack rule warns
against, plus per-action metering lock-in.

## Connector coverage

Coverage is **not** a blocker — every connector in Yomi's set exists in Composio:
Gmail, Google Calendar, Google Drive, GitHub, Slack, Notion, and Linear are all
in the catalog, and the longer-tail Google apps have dedicated toolkits: Google
Classroom (~62 actions), Google Tasks (~18), Google Contacts (~24), and Google
Meet (~15).
[[toolkits]](https://docs.composio.dev/toolkits)
[[classroom]](https://docs.composio.dev/toolkits/google_classroom)
[[meet]](https://composio.dev/toolkits/googlemeet)
[[tasks]](https://composio.dev/toolkits/googletasks)
The trade-off is that these are Composio's action shapes, not Yomi's — adopting
them means re-mapping to Composio's tool schemas rather than reusing the behaviour
Yomi already hand-tuned (e.g. the dry-run/approval and markdown-handling fixes
noted in Yomi's own connector history).

## Integration effort

Low, mechanically. `@composio/vercel` slots into Yomi's existing Vercel-AI-SDK
loop: `new Composio({ provider: new VercelProvider() })`, then
`session.tools()` yields AI-SDK tools you hand to the agent; execution is
automatic (and, per above, remote).
[[vercel provider]](https://docs.composio.dev/providers/vercel) It is TypeScript/
Node-native and should run on Bun. Behind Yomi's `ConnectorDef`/`ConnectorRegistry`
seam, a Composio-backed `ConnectorDef` would surface Composio tools as Yomi tools
and swap Yomi's own token store for Composio connected accounts — a clean adapter
in principle. The cost is not code volume; it is the data-path and vendor
consequences above.

## Fit against Yomi's 3 constraints

| Constraint | Verdict | Why |
| --- | --- | --- |
| **1. Google CASA / restricted scope** | **Fails** | Google requires the annual assessment for any app accessing restricted data "from or through a third-party server" ([restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [security assessment](https://support.google.com/cloud/answer/13465431)). Composio *is* that third-party server; it does not remove the burden and can enlarge assessment scope. Yomi still owns the OAuth app + verification. |
| **2. Privacy promise** | **Fails (default) / marginal (custom)** | Default managed flow stores tokens on and executes through Composio cloud ([connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts), [vercel](https://docs.composio.dev/providers/vercel)). No self-serve self-hosting ([#1037](https://github.com/ComposioHQ/composio/discussions/1037)). Would require renaming Composio as a data processor in Yomi's policy. |
| **3. Cost / lock-in** | **Fails the stack rule** | New managed vendor, per-tool-call billing that doesn't map to Yomi credits, compliance/self-host gated behind negotiated Enterprise tier ([pricing](https://composio.dev/pricing)). |

## Recommendation by use case

- **(a) Production Google connectors — No.** Violates constraints 1 and 2 with no
  mitigation short of an Enterprise VPC contract, which reintroduces constraint 3.
  Yomi already has encrypted-at-rest tokens and tuned Google tools; Composio adds
  a third-party data path and CASA surface for negative net value.
- **(b) Non-Google connectors (GitHub/Slack/Notion/Linear) — Weak maybe, only
  with custom auth.** These aren't restricted-scope, so CASA doesn't apply, but
  the privacy promise still does — content would transit Composio unless Yomi uses
  a custom (own-OAuth) config and pulls tokens back to execute locally, at which
  point Composio is a redundant vault over Yomi's existing one. Not worth the
  vendor for connectors already hand-rolled.
- **(c) Dev/testing convenience — Yes, bounded.** Useful to spike a *new*
  connector's action surface quickly on the free tier before committing to a
  hand-rolled `ConnectorDef` — as a scaffolding/reference tool, not a runtime
  dependency, and never pointed at real user restricted-scope data.

## Open questions / not fully verified

- **Token redaction for managed connections.** A Composio changelog reportedly
  hard-**REDACTED** Composio-managed OAuth tokens (so you *cannot* read them out
  and must execute through Composio), while the connected-accounts page describes
  uniform 4-char masking that can be disabled. I could not reconcile these two
  primary pages; the safe read is that *own-OAuth* tokens are retrievable and
  *managed* tokens may not be. Confirm against the current
  [changelog](https://docs.composio.dev/docs/changelog) before relying on the
  "pull token, execute locally" path.
- **`customAuthParams` at execution.** Search surfaced a `tools.execute()` path to
  inject your own token per call; the connected-accounts doc I fetched did not
  show it. Unverified against a primary page.
- **Data retention for non-YouTube data / subprocessor list / data residency.**
  The public [privacy policy](https://composio.dev/privacy) gives a 30-day figure
  for YouTube data only and no subprocessor/residency detail; the rest would need
  a DPA from Composio.
- **SOC 2 / ISO evidence.** Appears only as an Enterprise pricing line item; no
  public report or Trust Center page was located to confirm SOC 2 Type II / ISO
  27001 scope and currency.
- **Exact rate limits and connected-account caps** per tier are not stated on the
  [pricing](https://composio.dev/pricing) page; only tool-call quotas are public.
- **Post-Aug-15 pricing.** The pricing page warns of a change on 2026-08-15; the
  numbers in the table above may be stale shortly after this report's date.
