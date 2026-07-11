# Google Contacts Connector

Runtime definition: `packages/agent-core/src/connectors/google-contacts-def.ts`

Runtime id: `google-contacts`

Auth: OAuth 2.0 — `auth/contacts` (read + write), `contacts.other.readonly`,
`directory.readonly`, user email. All sensitive — brand verification, no CASA.

Requires the **People API** enabled in the Cloud project. **Not** the legacy
"Contacts API", which is shut down.

## Tools

| Tool                        | Type  | Purpose                                                       |
| --------------------------- | ----- | ------------------------------------------------------------- |
| `contacts-resolveRecipient` | Read  | Name → email address. The cross-app entry point.              |
| `contacts-searchContacts`   | Read  | Search by name, email, phone, or company; full records.       |
| `contacts-listContacts`     | Read  | List saved contacts.                                          |
| `contacts-getContact`       | Read  | One contact's full detail by resource id.                     |
| `contacts-createContact`    | Write | Save a new contact.                                           |
| `contacts-updateContact`    | Write | Change name, email, phone, or company.                        |
| `contacts-deleteContact`    | Write | Permanently delete (risk `irreversible`).                     |

## Cross-app: why this connector matters

`contacts-resolveRecipient` is what lets *"email Alex"* and *"lunch with Priya"*
work at all. The `gmail-sendEmail` and `calendar-createEvent` descriptions route
the model here before they will accept a name in place of an address, and the
tool **refuses to resolve when several people match** — it returns the candidates
and tells the agent to ask. Guessing an email address is the one failure mode
that sends a private message to a stranger, so it is designed to be un-guessable.

## Three address books, not one

`searchEverywhere()` fans out across all three in parallel:

| Source      | Scope                      | What's in it                                             |
| ----------- | -------------------------- | -------------------------------------------------------- |
| `contacts`  | `auth/contacts`            | Contacts the user actually saved.                        |
| `other`     | `contacts.other.readonly`  | People emailed but never saved. **Not** covered by `auth/contacts` — and on a personal Gmail this is most of the address book. |
| `directory` | `directory.readonly`       | The Workspace org directory. Returns **nothing** on a personal `@gmail.com`. |

The `other` and `directory` legs are best-effort (`.catch(() => [])`): a personal
account has no directory, and a 403 there must not sink a search that saved
contacts already answered. Results are ranked exact → prefix → substring, then
saved → directory → other, and deduped on primary email.

## Gotchas

- **Updates need the current etag.** People API rejects `updateContact` without
  it (optimistic concurrency against a stale overwrite), so the tool re-fetches
  the contact to read `etag` before every patch.
- `updatePersonFields` must list exactly the fields being changed, or the API
  silently drops them.
