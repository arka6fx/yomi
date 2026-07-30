# Spec 20 — Google OAuth & scopes (Cloud Console setup)

> **Purpose:** Step-by-step checklist to configure Google Cloud for Yomi’s
> existing Google connectors. Work through this in order; check each box before
> moving on.
>
> **Covers today:** Gmail, Calendar, Drive, Classroom (what’s in the codebase
> now).
>
> **Deferred (not in this checklist):** Google Docs / Sheets / Slides connectors
> and Drive binary upload/download tools. When those ship, see
> [Future scopes](#future-scopes-docs--sheets--slides) at the bottom.

---

## What you’re setting up

Yomi uses **one Google Cloud project** and **one OAuth 2.0 Web client** for all
Google connectors. Each connector has its own redirect URI and requests its own
scopes at connect time.

| Connector        | Provider id        | Redirect path                                 |
| ---------------- | ------------------ | --------------------------------------------- |
| Gmail            | `google`           | `/api/integrations/callback/google`           |
| Google Calendar  | `google-calendar`  | `/api/integrations/callback/google-calendar`  |
| Google Drive     | `google-drive`     | `/api/integrations/callback/google-drive`     |
| Google Classroom | `google-classroom` | `/api/integrations/callback/google-classroom` |

**Prod backend base URL:** `https://api.getyomi.in`  
**Prod app / landing URL:** `https://getyomi.in`  
**Local backend (dev):** `http://localhost:3001`

**Env vars (Cloudflare Workers / backend):**

- `GOOGLE_INTEGRATIONS_CLIENT_ID`
- `GOOGLE_INTEGRATIONS_CLIENT_SECRET`
- `BETTER_AUTH_BASE_URL` (used to build redirect URIs)

Source of truth for scopes:
`packages/agent-core/src/connectors/google-*-def.ts`.

---

## Scope reference (register all of these)

Register **every unique scope once** on the OAuth consent screen → **Data
access**. `userinfo.email` is shared by all four connectors but only needs to be
added once.

| Scope                                                              | Used by   | Google tier    | Notes                                                                |
| ------------------------------------------------------------------ | --------- | -------------- | -------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/gmail.modify`                     | Gmail     | **Restricted** | Read/send/modify mail (no permanent delete). Requires CASA.          |
| `https://www.googleapis.com/auth/gmail.send`                       | Gmail     | Sensitive      | Send mail.                                                           |
| `https://www.googleapis.com/auth/drive`                            | Drive     | **Restricted** | Full Drive access. Requires CASA for public release.                 |
| `https://www.googleapis.com/auth/calendar`                         | Calendar  | Sensitive      | Read + create/edit/delete events. Brand verification for public use. |
| `https://www.googleapis.com/auth/classroom.courses.readonly`       | Classroom | **Restricted** | Read enrolled classes.                                               |
| `https://www.googleapis.com/auth/classroom.coursework.me`          | Classroom | **Restricted** | Read + manage your own assignments / submissions.                    |
| `https://www.googleapis.com/auth/classroom.announcements.readonly` | Classroom | **Restricted** | Read class announcements.                                            |
| `https://www.googleapis.com/auth/userinfo.email`                   | All four  | Non-sensitive  | Shows connected account email in dashboard.                          |

**Copy-paste list (8 scopes):**

```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.coursework.me
https://www.googleapis.com/auth/classroom.announcements.readonly
https://www.googleapis.com/auth/userinfo.email
```

### Restricted vs sensitive (what it means for you)

| Tier          | Scopes in Yomi today                        | Test with your account            | Launch to all users                                              |
| ------------- | ------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Non-sensitive | `userinfo.email`                            | Works in Testing mode             | Works after publish                                              |
| Sensitive     | `calendar`, `gmail.send`                    | Works in Testing mode + test user | Brand verification (~2–3 business days)                          |
| Restricted    | `gmail.modify`, Drive, all Classroom scopes | Works in Testing mode + test user | Brand verification **+ annual CASA security assessment** (weeks) |

**Testing mode shortcut:** While the app is in **Testing** publishing status,
add your Google account under **Test users**. You can use restricted scopes
immediately — no CASA yet. Refresh tokens for sensitive/restricted scopes
**expire after 7 days** in Testing mode until you publish to Production.

---

## Step 0 — Before you open the console

- [ ] Decide which environment you will OAuth-connect in first. **Recommended:
      prod** (`https://api.getyomi.in`) so encrypted tokens match the same
      `ENCRYPTION_KEY` as your deployed backend.
- [ ] If you connect in prod, do not expect those tokens to decrypt in local dev
      (or vice versa) unless both use the **same** `ENCRYPTION_KEY`.
- [ ] Have access to DNS / Search Console for `getyomi.in` (needed later for
      verification, not for personal testing).

---

## Step 1 — Confirm project & OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Top-left **project picker** → select your Yomi project (create one if
   needed).
3. Go to **APIs & Services → Credentials**.
4. Under **OAuth 2.0 Client IDs**, find the **Web application** client used by
   Yomi.
   - You should have **exactly one** production Web client. Delete or ignore
     extras before verification.
5. Open the client → copy **Client ID** and **Client secret**.
6. Compare Client ID to `GOOGLE_INTEGRATIONS_CLIENT_ID` in your Cloudflare
   Worker secrets / backend env.

**Checklist**

- [ ] Project name noted: **\*\*\*\***\_\_\_\_**\*\*\*\***
- [ ] One Web OAuth client identified
- [ ] Client ID matches `GOOGLE_INTEGRATIONS_CLIENT_ID` in prod
- [ ] Client secret stored as `GOOGLE_INTEGRATIONS_CLIENT_SECRET` in prod

---

## Step 2 — Enable APIs

Go to **APIs & Services → Library** and enable each API:

| API                  | Search name            | Required for                                                               |
| -------------------- | ---------------------- | -------------------------------------------------------------------------- |
| Gmail API            | `Gmail API`            | Gmail connector                                                            |
| Google Calendar API  | `Google Calendar API`  | Calendar connector                                                         |
| Google Drive API     | `Google Drive API`     | Drive connector                                                            |
| Google Classroom API | `Google Classroom API` | Classroom connector                                                        |
| Google Slides API    | `Google Slides API`    | `drive-createFile` building multi-slide decks                              |
| Google Sheets API    | `Google Sheets API`    | `drive-readSheet` / `drive-appendSheetRows`                                |
| Google Docs API      | `Google Docs API`      | `drive-appendToDoc` / `drive-replaceInDoc`                                 |
| Google Tasks API     | `Google Tasks API`     | Tasks connector                                                            |
| People API           | `People API`           | Contacts connector — **not** the legacy "Contacts API", which is shut down |
| Google Meet API      | `Google Meet API`      | Meet connector                                                             |

> Slides and Sheets creation runs through the **Drive scope** (no extra scope),
> but the Slides API and Sheets API themselves must be enabled or those
> `drive-createFile` calls 403 with “API not enabled”.

**Checklist**

- [ ] Gmail API — Enabled
- [ ] Google Calendar API — Enabled
- [ ] Google Drive API — Enabled
- [ ] Google Classroom API — Enabled
- [ ] Google Slides API — Enabled
- [ ] Google Sheets API — Enabled

---

## Step 3 — OAuth consent screen (basics)

Go to **APIs & Services → OAuth consent screen**.

| Field                              | Value                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| User type                          | **External** (unless you only use Google Workspace internal users) |
| App name                           | `Yomi` (or your public product name)                               |
| User support email                 | Your support address                                               |
| App logo                           | Optional for Testing; **required** for brand verification          |
| App domain → Application home page | `https://getyomi.in`                                               |
| Authorized domains                 | `getyomi.in` (and `arka6fx.com` if privacy policy lives there)     |
| Developer contact email            | Your email                                                         |

**Publishing status for now:** leave as **Testing** until verification is
complete.

**Checklist**

- [ ] Consent screen created (External)
- [ ] App name + support email filled
- [ ] Home page URL set to `https://getyomi.in`
- [ ] `getyomi.in` added under Authorized domains

---

## Step 4 — Register scopes (Data access)

1. OAuth consent screen → **Data access** (or **Scopes** on older UI).
2. Click **Add or remove scopes**.
3. Add all **8 scopes** from the
   [Scope reference](#scope-reference-register-all-of-these) section.
   - Restricted scopes may show a warning — that’s expected.
4. Save.

**Checklist**

- [ ] `https://www.googleapis.com/auth/gmail.modify`
- [ ] `https://www.googleapis.com/auth/gmail.send`
- [ ] `https://www.googleapis.com/auth/drive`
- [ ] `https://www.googleapis.com/auth/calendar`
- [ ] `https://www.googleapis.com/auth/classroom.courses.readonly`
- [ ] `https://www.googleapis.com/auth/classroom.coursework.me`
- [ ] `https://www.googleapis.com/auth/classroom.announcements.readonly`
- [ ] `https://www.googleapis.com/auth/userinfo.email`

---

## Step 5 — Test users (required while in Testing mode)

1. OAuth consent screen → **Audience** (or **Test users**).
2. Click **Add users**.
3. Add every Google account you will connect (your personal Gmail, any team
   testers).

Without this, OAuth fails with “access blocked” for accounts not on the list.

**Checklist**

- [ ] Your Gmail added as test user
- [ ] Any other tester emails added

---

## Step 6 — Redirect URIs on the OAuth client

Go to **APIs & Services → Credentials → [your Web client] → Authorized redirect
URIs**.

Add **all** of these (prod + local if you dev locally):

**Production**

```
https://api.getyomi.in/api/integrations/callback/google
https://api.getyomi.in/api/integrations/callback/google-calendar
https://api.getyomi.in/api/integrations/callback/google-drive
https://api.getyomi.in/api/integrations/callback/google-classroom
```

**Local dev (optional)**

```
http://localhost:3001/api/integrations/callback/google
http://localhost:3001/api/integrations/callback/google-calendar
http://localhost:3001/api/integrations/callback/google-drive
http://localhost:3001/api/integrations/callback/google-classroom
```

Save. Google may take a few minutes to propagate URI changes.

**Checklist**

- [ ] All 4 prod redirect URIs added
- [ ] Local URIs added (if needed)
- [ ] No stale / duplicate OAuth Web clients left configured

---

## Step 7 — Backend secrets

Set on your Cloudflare Worker (or local `.env`):

```bash
GOOGLE_INTEGRATIONS_CLIENT_ID=<from Step 1>
GOOGLE_INTEGRATIONS_CLIENT_SECRET=<from Step 1>
BETTER_AUTH_BASE_URL=https://api.getyomi.in   # prod
```

Local only:

```bash
BETTER_AUTH_BASE_URL=http://localhost:3001
```

**Checklist**

- [ ] Client ID + secret deployed to prod Worker
- [ ] `BETTER_AUTH_BASE_URL` matches the host used in redirect URIs

---

## Step 8 — Smoke test (per connector)

Connect each integration from the Yomi dashboard (**Integrations** tab) or via
Telegram agent connect flow.

| Connector | Connect                  | Quick validation                                                                                   |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| Gmail     | Connect Google Gmail     | Ask agent to list recent emails or search inbox                                                    |
| Calendar  | Connect Google Calendar  | Ask agent to list today’s events                                                                   |
| Drive     | Connect Google Drive     | Ask agent to search Drive or read a Doc/Sheet                                                      |
| Classroom | Connect Google Classroom | Ask agent to list classes (needs Workspace for Education for full data; personal Gmail is limited) |

**Checklist**

- [ ] Gmail OAuth completes; consent shows correct app name + scopes
- [ ] Calendar OAuth completes
- [ ] Drive OAuth completes
- [ ] Classroom OAuth completes (or expected limitation documented for personal
      Gmail)

---

## Later — Verification & public launch

Do these when you’re ready for **external users**, not for solo testing.

### Phase A — Prerequisites

- [ ] Privacy policy URL on `getyomi.in` (must mention Google data +
      [Limited Use](https://developers.google.com/terms/api-services-user-data-policy))
- [ ] Terms of service URL (same domain)
- [ ] Domain ownership verified in
      [Google Search Console](https://search.google.com/search-console)
- [ ] App logo uploaded on consent screen

### Phase B — Brand verification (sensitive scopes)

- [ ] Submit OAuth consent screen for verification
- [ ] Demo video showing: consent screen (app name + client ID in URL bar), each
      sensitive/restricted feature in use
- [ ] ~2–3 business days for brand review

### Phase C — Restricted scope verification (Gmail, Drive, Classroom)

- [ ] Complete **CASA** (Cloud Application Security Assessment) — annual for
      restricted scopes
- [ ] Budget several weeks; this is the main blocker for public
      Gmail/Drive/Classroom

### Phase D — Production

- [ ] Change publishing status from **Testing** → **In production**
- [ ] Refresh tokens stop expiring every 7 days for all users

**Official references**

- [OAuth app verification (Cloud help)](https://support.google.com/cloud/answer/13463073)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

---

## Future scopes (Docs / Sheets / Slides)

When those three connectors are implemented (separate from Drive — native edit
via each API, no extra Drive scope):

| Connector     | Scope                                           | Tier      |
| ------------- | ----------------------------------------------- | --------- |
| Google Docs   | `https://www.googleapis.com/auth/documents`     | Sensitive |
| Google Sheets | `https://www.googleapis.com/auth/spreadsheets`  | Sensitive |
| Google Slides | `https://www.googleapis.com/auth/presentations` | Sensitive |

Also enable in **Library**:

- Google Docs API
- Google Sheets API
- Google Slides API

Add redirect URIs:

```
https://api.getyomi.in/api/integrations/callback/google-docs
https://api.getyomi.in/api/integrations/callback/google-sheets
https://api.getyomi.in/api/integrations/callback/google-slides
```

These are **sensitive, not restricted** — they do **not** add CASA burden beyond
what Gmail/Drive already require. Discovery of existing files by name stays on
the Drive connector; Docs/Sheets/Slides connectors edit by file ID.

---

## Quick troubleshooting

| Symptom                           | Likely fix                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `redirect_uri_mismatch`           | Redirect URI in console doesn’t exactly match `BETTER_AUTH_BASE_URL` + callback path |
| Access blocked / app not verified | Add your email under Test users; app still in Testing mode                           |
| `invalid_scope`                   | Scope not registered on consent screen Data access page                              |
| Connected in prod, fails in local | Different `ENCRYPTION_KEY` — reconnect in the environment you’re using               |
| Token expires every ~7 days       | Normal in Testing mode for sensitive/restricted scopes until Production              |
| Classroom empty on personal Gmail | Classroom API is limited without Google Workspace for Education                      |

---

## One-page checklist (printable)

```
[ ] Step 1  Project + OAuth Web client confirmed
[ ] Step 2  10 APIs enabled (Gmail, Calendar, Drive, Classroom, Slides, Sheets,
            Docs, Tasks, People, Meet)
[ ] Step 3  Consent screen basics + authorized domain
[ ] Step 4  15 scopes registered on Data access
[ ] Step 5  Test users added
[ ] Step 6  7 prod redirect URIs (+ local if needed)
[ ] Step 7  GOOGLE_* secrets + BETTER_AUTH_BASE_URL in Worker
[ ] Step 8  All 7 connectors smoke-tested
```
