# Spec 24 — Google OAuth verification: scopes, justifications & demo video

> **Purpose:** Everything Google asks for when you submit the OAuth consent
> screen for verification: the final scope list, the written justification for
> each scope, and a scene-by-scene demo video script you record and link.
>
> **Prereq:** Finish [Spec 20](./20-google-oauth-console-setup.md) (project,
> APIs, consent screen, scopes, redirect URIs) first. This spec is the
> submission step.
>
> Source of truth for scopes:
> the Google connector runtime defs (Python port in progress at
> `apps/api/src/yomi/connectors/`).

---

## 1. Final scope list (12 scopes)

Register exactly these on **OAuth consent screen → Data access**. Tier drives
how much review each needs — and these tiers are what the console **actually
reported**, not a prediction.

| Scope                                                              | Connector | Tier           | CASA? |
| ------------------------------------------------------------------ | --------- | -------------- | ----- |
| `https://www.googleapis.com/auth/gmail.modify`                     | Gmail     | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/drive`                            | Drive     | **Restricted** | Yes   |
| `https://www.googleapis.com/auth/gmail.send`                       | Gmail     | Sensitive      | No    |
| `https://www.googleapis.com/auth/calendar`                         | Calendar  | Sensitive      | No    |
| `https://www.googleapis.com/auth/tasks`                            | Tasks     | Sensitive      | No    |
| `https://www.googleapis.com/auth/meetings.space.created`           | Meet      | Sensitive      | No    |
| `https://www.googleapis.com/auth/meetings.space.readonly`          | Meet      | Sensitive      | No    |
| `https://www.googleapis.com/auth/meetings.space.settings`          | Meet      | Non-sensitive  | No    |
| `https://www.googleapis.com/auth/classroom.courses.readonly`       | Classroom | Non-sensitive  | No    |
| `https://www.googleapis.com/auth/classroom.coursework.me`          | Classroom | Non-sensitive  | No    |
| `https://www.googleapis.com/auth/classroom.announcements.readonly` | Classroom | Non-sensitive  | No    |
| `https://www.googleapis.com/auth/userinfo.email`                   | All       | Non-sensitive  | No    |

**Only two scopes are restricted** — `gmail.modify` and `drive`. Everything else
is sensitive or free. Adding Tasks and Meet therefore costs brand-review
justification text and video scenes, but **no additional CASA burden**.

Scopes deliberately NOT requested: `https://mail.google.com/` (includes
permanent delete — no Yomi tool needs it), `tasks.readonly` (Yomi writes to
tasks), `classroom.student-submissions.me.readonly` (subsumed by
`coursework.me`).

No Google Contacts / People API scopes are requested — Yomi has no Contacts
connector (the catalog at `packages/ui/src/catalog.ts` has no
google-contacts entry).

### Deltas from a console that was set up before this pass

If your **Data access** page currently shows `https://mail.google.com/` and
`classroom.student-submissions.me.readonly`, it predates the connector rework:

| Action     | Scope                                       | Why                                                                                             |
| ---------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Add**    | `classroom.coursework.me`                   | The def requests it; `student-submissions.me.readonly` cannot read coursework or attach/turn in |
| **Add**    | `gmail.modify`, `gmail.send`                | What the def now requests                                                                       |
| **Remove** | `https://mail.google.com/`                  | Superset incl. permanent delete — worst restricted scope, and no tool uses it now               |
| **Remove** | `classroom.student-submissions.me.readonly` | Redundant once `coursework.me` is present                                                       |

**No scope changes are needed for Slides or Sheets.** The Slides and Sheets APIs
both accept `auth/drive`, which is already requested. What they need is the API
itself **enabled** in the Library — see
[Spec 20](./20-google-oauth-console-setup.md) step 2 (9 APIs). Scope ≠ API
enablement; without enabling, `drive-createFile` 403s on deck/spreadsheet
creation even with a valid `drive` token.

**What "verified" requires per tier**

- **Non-sensitive** (`userinfo.email`): nothing beyond publishing.
- **Sensitive** (`gmail.send`, `calendar`, `tasks`, `meetings.space.created`,
  `meetings.space.readonly`): brand verification — consent screen review +
  demo video. ~2–3 business days.
- **Restricted** (`gmail.modify`, `drive` — only these two): brand verification
  **plus** an annual **CASA** (Cloud Application Security Assessment) tier-2
  security review. Weeks, and it recurs yearly. This is the real gate; budget
  for it.

> **`drive` is the scope reviewers scrutinize most.** See §4 before submitting —
> you may want `drive.file` instead to dodge CASA, at a feature cost.

---

## 2. Per-scope justification text

Google's verification form asks, for each scope: _"Why does your app need this
scope?"_ and _"How does your app use the data?"_ Paste these; they map to the
actual tools and to
[Limited Use](https://developers.google.com/terms/api-services-user-data-policy).

**`gmail.modify` (restricted)**

> Yomi is a personal AI assistant. On the user's explicit request it reads and
> searches their inbox to answer questions and summarise mail, and organises
> messages the user asks it to — applying/removing labels, archiving, marking
> read/unread, moving to trash, and creating drafts. `modify` is the minimum
> scope covering read + these organise actions. We deliberately do **not**
> request `https://mail.google.com/`; Yomi never permanently deletes mail. Data
> is used only to fulfil the user's in-session request and is not sold,
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

**`classroom.courses.readonly` (non-sensitive)**

> Read the list of the signed-in user's own classes so the user can ask about
> their coursework. Read-only.

**`classroom.coursework.me` (non-sensitive)**

> Read the signed-in student's own assignments, due dates, and submission
> status, and — only for coursework created through Yomi — attach a file or turn
> it in on the user's request. Scoped to the user's own work (`.me`).

**`classroom.announcements.readonly` (non-sensitive)**

> Read announcements in the user's classes so Yomi can surface them on request.
> Read-only.

**`tasks` (sensitive)**

> Yomi manages the user's own to-do list on request: listing what's due,
> creating tasks, changing due dates, marking them done, and deleting them. Read
> and write are both needed — a read-only scope would make the assistant unable
> to capture a task the user asks it to remember.

**`meetings.space.created` (sensitive)**

> Create a Google Meet link when the user asks for one, and end a call Yomi
> itself started. Scoped to spaces created by this app.

**`meetings.space.readonly` (sensitive)**

> Read the user's past meetings — participants and, where available, the
> transcript — so Yomi can summarise a meeting or extract action items on
> request. Read-only.

**`meetings.space.settings` (non-sensitive)**

> Read and set access settings (who can join) on a Meet space Yomi created.

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

### 3.0 Dry run first — do NOT record cold

Run every prompt below once before recording. A scene that 403s mid-take costs a
whole re-record, and a scope the reviewer watches **fail** is worse than one
with no demo. Seed the data the scenes assume, then confirm each call actually
returns.

| #   | Seed this first                                 | Then dry-run this ask                             | Scope proved              |
| --- | ----------------------------------------------- | ------------------------------------------------- | ------------------------- |
| 1   | 2–3 unread mails, one labelled-able             | "Show my most important unread emails"            | `gmail.modify` (read)     |
| 2   | —                                               | "Archive the newsletter"                          | `gmail.modify` (organise) |
| 3   | —                                               | "Reply to X saying I'll review it tomorrow"       | `gmail.send`              |
| 4   | A Doc named e.g. **Budget 2026**                | "Find my budget doc and summarise it"             | `drive` (read existing)   |
| 5   | —                                               | "Create a slide deck outlining Q3 goals"          | `drive` + Slides API      |
| 6   | A sheet with a header row                       | "Add a ₹450 coffee expense to my budget sheet"    | `drive` + Sheets API      |
| 7   | 2 upcoming events                               | "What's on my calendar this week?"                | `calendar`                |
| 8   | One Classroom class w/ an assignment            | "What's my next assignment and what does it ask?" | `classroom.coursework.me` |
| 9   | 2 tasks, one completable                        | "What's on my to-do list this week?"              | `tasks`                   |
| 10  | —                                               | "Give me a Meet link"                             | `meetings.space.created`  |
| 11  | Join + leave that Meet once, so a record exists | "Who was on my last call?"                        | `meetings.space.readonly` |

**Known limits to narrate rather than fight** (both are expected, not bugs):

- **Meet transcripts** need a paid Workspace plan. On personal Gmail, Yomi says
  so instead of failing — show that. The participants read-back (#11) is what
  carries `meetings.space.readonly`, so #11 is the one that must work.
- **Classroom turn-in / attach** only works on coursework _Yomi itself created_
  — a Google restriction, not a Yomi bug. Demo reading the assignment; don't
  attempt a turn-in on a teacher-created one, it will 403 on camera.

If anything else errors during the dry run, stop and fix it — don't record
around it.

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
- Ask: "Create a slide deck outlining Q3 goals." → show the created Google
  Slides deck opening in Drive (create + Slides API).

**Scene 4 — Calendar `calendar` (25s)**

- Ask: "What's on my calendar this week?" → list events.
- Ask: "Book lunch with Alex Friday at 1pm." → approval → event created; open
  it.

**Scene 5 — Classroom scopes (30s)**

- Ask: "List my classes." (`courses.readonly`)
- Ask: "What's my next assignment and what does it ask?" → shows coursework +
  description (`coursework.me`).
- Ask: "Any new announcements?" (`announcements.readonly`)
- (If on a personal Gmail with no Education account, narrate that Classroom data
  is limited but the scope/flow is identical — still show the calls being made.)

**Scene 6 — Tasks `tasks` (25s)**

- Ask: "What's on my to-do list this week?" → list tasks with due dates.
- Ask: "Add 'renew passport' due Friday." → approval → task created; open Google
  Tasks to show it.
- Ask: "Mark the laundry one done." → task completes.

**Scene 7 — Meet `meetings.space.*` (25s)**

- Ask: "Give me a Meet link." → approval → link created; open it.
- Ask: "Who was on my last call?" → show participants from the conference
  record.
- **If on a personal Gmail:** narrate that transcripts require a paid Workspace
  plan, and show Yomi _saying so_ rather than failing. Reviewers accept a
  clearly explained limitation; they reject a scope with no visible use, so the
  participants read-back is what carries `meetings.space.readonly`.

**Scene 8 — Sheets + Docs editing (20s, no extra scope — runs on `drive`)**

- Ask: "Add a ₹450 coffee expense to my budget sheet." → approval → open the
  sheet and show the appended row.
- Ask: "Append today's notes to my journal doc." → approval → show the Doc.

**Scene 9 — Close (10s)**

- Return to the dashboard showing all six Google integrations connected.
- Say: "All access is used only to fulfil the user's request and follows
  Google's Limited Use policy."

**Length target:** 4–6 minutes with all six connectors. Upload **unlisted**,
paste the link into the verification form.

> **Every requested scope needs a visible use.** A scope the reviewer cannot see
> exercised is the single most common rejection cause — that is why Tasks and
> Meet could not be registered before the connectors existed.

---

## 4. Decision: full `drive` vs `drive.file` (read before submitting)

Full `https://www.googleapis.com/auth/drive` is restricted → triggers CASA and
is the most-rejected scope. The lighter `drive.file` is **not** restricted (no
CASA) but only sees files the app created or the user hand-picked via the Google
Picker — so "summarise my budget doc" by name would stop working.

| Option                 | CASA? | Cost                                                                 |
| ---------------------- | ----- | -------------------------------------------------------------------- |
| Keep full `drive`      | Yes   | Search/read any existing file by name keeps working; weeks of CASA.  |
| Switch to `drive.file` | No    | Drops name-based discovery + Drive-wide RAG sync; add a file Picker. |

Since Gmail/Classroom already force CASA, keeping full `drive` adds no _new_
CASA burden — so **keep `drive`** unless you want to drop Gmail `modify` and
Classroom too and ship a sensitive-only app. Decide before recording; the video
must match the scopes you submit.

---

## 5. Submission checklist

- [ ] Spec 20 fully done (12 scopes registered, 9 APIs enabled, 6 redirect URI
      pairs)
- [ ] Privacy policy + ToS live on `getyomi.in`, both mention Google data +
      Limited Use
- [ ] `getyomi.in` verified in Google Search Console; listed as Authorized
      domain
- [ ] App logo uploaded on the consent screen
- [ ] Justification text (§2) pasted for every scope
- [ ] Demo video recorded per §3, consent screen + client ID clearly shown,
      uploaded unlisted
- [ ] Video link + justifications submitted; consent screen pushed for
      verification
- [ ] Brand review (~2–3 days) for the five sensitive scopes
- [ ] CASA engaged for the two restricted scopes (`gmail.modify`, `drive`) —
      start early
- [ ] After approval: publishing status **Testing → In production**

**Until approved:** stay in **Testing** mode with your accounts under Test
users. Restricted/sensitive refresh tokens expire every 7 days in Testing —
normal until Production.
