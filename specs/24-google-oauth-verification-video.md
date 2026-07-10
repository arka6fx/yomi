# Spec 24 — Google OAuth verification: scopes, justifications & demo video

> **Purpose:** Everything Google asks for when you submit the OAuth consent
> screen for verification: the final scope list, the written justification for
> each scope, and a scene-by-scene demo video script you record and link.
>
> **Prereq:** Finish [Spec 20](./20-google-oauth-console-setup.md) (project,
> APIs, consent screen, scopes, redirect URIs) first. This spec is the
> submission step.
>
> Source of truth for scopes: `packages/agent-core/src/connectors/google-*-def.ts`.

---

## 1. Final scope list (8 scopes)

Register exactly these on **OAuth consent screen → Data access**. Tier drives how
much review each needs.

| Scope                                                              | Connector | Tier           | CASA? |
| ------------------------------------------------------------------ | --------- | -------------- | ----- |
| `https://www.googleapis.com/auth/gmail.modify`                     | Gmail     | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/gmail.send`                       | Gmail     | Sensitive      | No    |
| `https://www.googleapis.com/auth/drive`                            | Drive     | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/calendar`                         | Calendar  | Sensitive      | No    |
| `https://www.googleapis.com/auth/classroom.courses.readonly`       | Classroom | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/classroom.coursework.me`          | Classroom | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/classroom.announcements.readonly` | Classroom | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/userinfo.email`                   | All       | Non-sensitive  | No    |

**What "verified" requires per tier**

- **Non-sensitive** (`userinfo.email`): nothing beyond publishing.
- **Sensitive** (`gmail.send`, `calendar`): brand verification — consent screen
  review + demo video. ~2–3 business days.
- **Restricted** (`gmail.modify`, `drive`, all three Classroom scopes): brand
  verification **plus** an annual **CASA** (Cloud Application Security
  Assessment) tier-2 security review. Weeks, and it recurs yearly. This is the
  real gate; budget for it.

> **`drive` is the scope reviewers scrutinize most.** See §4 before submitting —
> you may want `drive.file` instead to dodge CASA, at a feature cost.

---

## 2. Per-scope justification text

Google's verification form asks, for each scope: *"Why does your app need this
scope?"* and *"How does your app use the data?"* Paste these; they map to the
actual tools and to [Limited Use](https://developers.google.com/terms/api-services-user-data-policy).

**`gmail.modify` (restricted)**
> Yomi is a personal AI assistant. On the user's explicit request it reads and
> searches their inbox to answer questions and summarise mail, and organises
> messages the user asks it to — applying/removing labels, archiving, marking
> read/unread, moving to trash, and creating drafts. `modify` is the minimum
> scope covering read + these organise actions. We deliberately do **not**
> request `https://mail.google.com/`; Yomi never permanently deletes mail.
> Data is used only to fulfil the user's in-session request and is not sold,
> transferred, or used for ads or model training.

**`gmail.send` (sensitive)**
> Used only to send an email or a threaded reply that the user has reviewed and
> explicitly approved in the app. Every send is gated behind an approval step
> that shows the recipients, subject, and body before anything leaves.

**`drive` (restricted)**
> The user refers to their existing Drive files by name ("summarise my budget
> doc"), so Yomi must search and read files it did not create — which
> `drive.file` cannot do. On request it also creates artifacts (Docs from
> Markdown, multi-slide decks, spreadsheets), converts files, and saves email
> attachments the user asks to keep. Access is used only to satisfy the user's
> in-session request; no bulk access, transfer, ads, or model training.

**`calendar` (sensitive)**
> On request Yomi lists upcoming events and creates, edits, or deletes events
> the user asks for. Create/edit/delete actions are shown to the user for
> approval before they run.

**`classroom.courses.readonly` (restricted)**
> Read the list of the signed-in user's own classes so the user can ask about
> their coursework. Read-only.

**`classroom.coursework.me` (restricted)**
> Read the signed-in student's own assignments, due dates, and submission
> status, and — only for coursework created through Yomi — attach a file or turn
> it in on the user's request. Scoped to the user's own work (`.me`).

**`classroom.announcements.readonly` (restricted)**
> Read announcements in the user's classes so Yomi can surface them on request.
> Read-only.

**`userinfo.email` (non-sensitive)**
> Show which Google account is connected in the dashboard.

---

## 3. Demo video script (record this, link an unlisted YouTube URL)

Google's reviewers must see, in one continuous flow: **(a)** the OAuth consent
screen with your **app name** and the **client ID visible in the browser URL
bar**, and **(b)** each requested scope actually being used. Keep it in English,
unhurried, one scope-group per scene.

**Setup before recording**
- Use a **test-user** Google account with real-ish data (a few emails, a couple
  Calendar events, a Doc named something memorable, one Classroom class).
- Sign out of Yomi so you can show the full connect flow from scratch.
- Screen-record at 1080p; no cuts within a scene; narrate what you click.

**Scene 0 — App identity (10s)**
- Show `https://getyomi.in`, then the dashboard **Integrations** tab.
- Say: "This is Yomi, an AI assistant. Client ID <paste your client_id>."

**Scene 1 — Consent screen + client ID (20s) — REQUIRED**
- Click **Connect Google Gmail**. Let the Google consent screen load.
- **Pause on the consent screen.** Point out the **app name "Yomi"** and hover
  the browser **URL bar so `client_id=...` is legible**. This is the shot Google
  most often rejects videos for missing.
- Grant access; land back on the dashboard showing Gmail connected.

**Scene 2 — Gmail `modify` + `send` (40s)**
- Ask Yomi: "Show my most important unread emails." → shows inbox data.
- Ask: "Archive the newsletter" and "label the invoice as Finance." → show the
  organise actions (uses `modify`).
- Ask: "Reply to <sender> saying I'll review it tomorrow." → show the **approval
  card** with recipients/subject/body, click approve → sent (uses `send`).

**Scene 3 — Drive `drive` (35s)**
- Ask: "Find my budget doc and summarise it." → shows search + read of a
  pre-existing file (justifies full `drive`).
- Ask: "Create a slide deck outlining Q3 goals." → show the created Google Slides
  deck opening in Drive (create + Slides API).

**Scene 4 — Calendar `calendar` (25s)**
- Ask: "What's on my calendar this week?" → list events.
- Ask: "Book lunch with Alex Friday at 1pm." → approval → event created; open it.

**Scene 5 — Classroom scopes (30s)**
- Ask: "List my classes." (`courses.readonly`)
- Ask: "What's my next assignment and what does it ask?" → shows coursework +
  description (`coursework.me`).
- Ask: "Any new announcements?" (`announcements.readonly`)
- (If on a personal Gmail with no Education account, narrate that Classroom data
  is limited but the scope/flow is identical — still show the calls being made.)

**Scene 6 — Close (10s)**
- Return to the dashboard showing all four Google integrations connected.
- Say: "All access is used only to fulfil the user's request and follows
  Google's Limited Use policy."

**Length target:** 2.5–4 minutes. Upload **unlisted**, paste the link into the
verification form.

---

## 4. Decision: full `drive` vs `drive.file` (read before submitting)

Full `https://www.googleapis.com/auth/drive` is restricted → triggers CASA and is
the most-rejected scope. The lighter `drive.file` is **not** restricted (no CASA)
but only sees files the app created or the user hand-picked via the Google
Picker — so "summarise my budget doc" by name would stop working.

| Option              | CASA?      | Cost                                                                 |
| ------------------- | ---------- | -------------------------------------------------------------------- |
| Keep full `drive`   | Yes        | Search/read any existing file by name keeps working; weeks of CASA.  |
| Switch to `drive.file` | No      | Drops name-based discovery + Drive-wide RAG sync; add a file Picker.  |

Since Gmail/Classroom already force CASA, keeping full `drive` adds no *new* CASA
burden — so **keep `drive`** unless you want to drop Gmail `modify` and Classroom
too and ship a sensitive-only app. Decide before recording; the video must match
the scopes you submit.

---

## 5. Submission checklist

- [ ] Spec 20 fully done (8 scopes registered, 6 APIs enabled, redirect URIs)
- [ ] Privacy policy + ToS live on `getyomi.in`, both mention Google data + Limited Use
- [ ] `getyomi.in` verified in Google Search Console; listed as Authorized domain
- [ ] App logo uploaded on the consent screen
- [ ] Justification text (§2) pasted for every scope
- [ ] Demo video recorded per §3, consent screen + client ID clearly shown, uploaded unlisted
- [ ] Video link + justifications submitted; consent screen pushed for verification
- [ ] Brand review (~2–3 days) for the sensitive scopes
- [ ] CASA engaged for the restricted scopes (Gmail/Drive/Classroom) — start early
- [ ] After approval: publishing status **Testing → In production**

**Until approved:** stay in **Testing** mode with your accounts under Test users.
Restricted/sensitive refresh tokens expire every 7 days in Testing — normal until
Production.
