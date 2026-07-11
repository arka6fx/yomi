import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

interface Person {
  resourceName?: string
  etag?: string
  names?: { displayName?: string; givenName?: string; familyName?: string }[]
  emailAddresses?: { value?: string; type?: string }[]
  phoneNumbers?: { value?: string; type?: string }[]
  organizations?: { name?: string; title?: string }[]
}

type ContactSource = "contacts" | "other" | "directory"

interface ShapedContact {
  id?: string
  name: string
  emails: string[]
  phones: string[]
  organization?: string
  source: ContactSource
}

const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations"

export function shapePerson(p: Person, source: ContactSource): ShapedContact {
  const org = p.organizations?.[0]
  return {
    id: p.resourceName,
    name: p.names?.[0]?.displayName ?? p.emailAddresses?.[0]?.value ?? "(no name)",
    emails: (p.emailAddresses ?? []).map((e) => e.value).filter((v): v is string => !!v),
    phones: (p.phoneNumbers ?? []).map((e) => e.value).filter((v): v is string => !!v),
    organization: [org?.title, org?.name].filter(Boolean).join(" at ") || undefined,
    source,
  }
}

// Rank candidates so an exact name match beats a substring, and a saved contact
// beats an "other contact" scraped from mail history.
const SOURCE_RANK: Record<ContactSource, number> = { contacts: 0, directory: 1, other: 2 }

export function rankCandidates(candidates: ShapedContact[], query: string): ShapedContact[] {
  const q = query.trim().toLowerCase()
  const score = (c: ShapedContact): number => {
    const name = c.name.toLowerCase()
    if (name === q) return 0
    if (name.startsWith(q)) return 1
    if (name.includes(q)) return 2
    return 3
  }
  return [...candidates].sort(
    (a, b) => score(a) - score(b) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
  )
}

// Same person can appear in both saved and "other" contacts — dedupe on the
// primary email, keeping the higher-ranked (already-sorted) entry.
function dedupe(list: ShapedContact[]): ShapedContact[] {
  const seen = new Set<string>()
  const out: ShapedContact[] = []
  for (const c of list) {
    const key = (c.emails[0] ?? c.name).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

export function createContactsTools(ctx: ConnectorContext): ToolSet {
  async function peopleApi<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "google-contacts")
    const res = await fetch(`https://people.googleapis.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`People API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  // Search all three address books the user has. `otherContacts` holds people the
  // user has emailed but never saved — on a personal Gmail that is most of them —
  // and `directory` only returns anything on Workspace accounts, so both are
  // best-effort: a failure there must not sink a search that saved contacts answered.
  async function searchEverywhere(query: string, pageSize: number): Promise<ShapedContact[]> {
    const q = encodeURIComponent(query)
    const saved = peopleApi<{ results?: { person?: Person }[] }>(
      `/people:searchContacts?query=${q}&pageSize=${pageSize}&readMask=${PERSON_FIELDS}`,
    ).then((d) => (d.results ?? []).map((r) => shapePerson(r.person ?? {}, "contacts")))

    const other = peopleApi<{ results?: { person?: Person }[] }>(
      `/otherContacts:search?query=${q}&pageSize=${pageSize}&readMask=names,emailAddresses`,
    )
      .then((d) => (d.results ?? []).map((r) => shapePerson(r.person ?? {}, "other")))
      .catch(() => [] as ShapedContact[])

    const directory = peopleApi<{ results?: { person?: Person }[] }>(
      `/people:searchDirectoryPeople?query=${q}&pageSize=${pageSize}&readMask=${PERSON_FIELDS}&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`,
    )
      .then((d) => (d.results ?? []).map((r) => shapePerson(r.person ?? {}, "directory")))
      .catch(() => [] as ShapedContact[])

    const [a, b, c] = await Promise.all([saved, other, directory])
    return dedupe(rankCandidates([...a, ...b, ...c], query))
  }

  return {
    "contacts-resolveRecipient": tool({
      description:
        "Turn a person's NAME into their email address. Call this FIRST whenever the user refers to " +
        "someone by name instead of an address — 'email Alex about the invoice', 'invite Priya to the " +
        "meeting' — then pass the returned email to gmail-sendEmail, gmail-replyToThread, or " +
        "calendar-createEvent. Searches saved contacts, people the user has emailed before, and the " +
        "Workspace directory. If it returns several candidates or none, ASK THE USER which address to " +
        "use — never guess an email address.",
      parameters: z.object({
        name: z.string().describe("The person's name as the user said it, e.g. 'Alex' or 'Priya Shah'"),
      }),
      execute: async ({ name }) => {
        try {
          const matches = (await searchEverywhere(name, 10)).filter((c) => c.emails.length > 0)
          if (matches.length === 0) {
            return {
              matches: [],
              message: `No contact found matching "${name}". Ask the user for the email address.`,
            }
          }
          const top = matches[0]!
          return {
            count: matches.length,
            resolved: matches.length === 1 ? top.emails[0] : undefined,
            matches: matches.slice(0, 5).map((c) => ({
              name: c.name,
              email: c.emails[0],
              otherEmails: c.emails.slice(1),
              organization: c.organization,
              source: c.source,
            })),
            message:
              matches.length === 1
                ? `${top.name} <${top.emails[0]}>`
                : `${matches.length} people match "${name}" — ask the user which one before sending anything.`,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "contacts-searchContacts": tool({
      description:
        "Search the user's contacts by name, email, phone, or company. Returns full contact records. " +
        "If you only need an email address to send something, use contacts-resolveRecipient instead.",
      parameters: z.object({
        query: z.string().describe("Search text — a name, email, phone number, or company"),
        maxResults: z.number().int().min(1).max(30).default(10).describe("Max contacts to return"),
      }),
      execute: async ({ query, maxResults }) => {
        try {
          const contacts = (await searchEverywhere(query, maxResults)).slice(0, maxResults)
          if (contacts.length === 0)
            return { contacts: [], message: `No contacts match "${query}".` }
          return { count: contacts.length, contacts }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "contacts-listContacts": tool({
      description:
        "List the user's saved contacts. Use this only for 'show me my contacts' — to find one " +
        "specific person, contacts-searchContacts is far cheaper.",
      parameters: z.object({
        maxResults: z.number().int().min(1).max(100).default(50).describe("Max contacts to return"),
      }),
      execute: async ({ maxResults }) => {
        try {
          const data = await peopleApi<{ connections?: Person[]; totalPeople?: number }>(
            `/people/me/connections?pageSize=${maxResults}&personFields=${PERSON_FIELDS}&sortOrder=FIRST_NAME_ASCENDING`,
          )
          const contacts = (data.connections ?? []).map((p) => shapePerson(p, "contacts"))
          if (contacts.length === 0) return { contacts: [], message: "No saved contacts." }
          return { count: contacts.length, totalContacts: data.totalPeople, contacts }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "contacts-getContact": tool({
      description:
        "Get one contact's full details by resource ID. Get the id from contacts-searchContacts " +
        "(it looks like 'people/c12345').",
      parameters: z.object({
        contactId: z.string().describe("Contact resource name, e.g. people/c12345"),
      }),
      execute: async ({ contactId }) => {
        try {
          const person = await peopleApi<Person>(
            `/${contactId}?personFields=${PERSON_FIELDS},biographies,addresses`,
          )
          return shapePerson(person, "contacts")
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "contacts-createContact": tool({
      description:
        "Save a new contact to the user's Google Contacts — 'save Priya's number', 'add this person " +
        "to my contacts'. Check with contacts-searchContacts first so you don't create a duplicate.",
      parameters: z.object({
        givenName: z.string().describe("First name"),
        familyName: z.string().optional().describe("Last name"),
        email: z.string().optional().describe("Email address"),
        phone: z.string().optional().describe("Phone number"),
        organization: z.string().optional().describe("Company or organization"),
        jobTitle: z.string().optional().describe("Job title"),
      }),
      execute: async (args) => {
        const { givenName, familyName, email, phone, organization, jobTitle } = args
        const fullName = [givenName, familyName].filter(Boolean).join(" ")
        return gateWrite(
          ctx,
          {
            connector: "google-contacts",
            action: "contacts-createContact",
            risk: "write",
            title: `Save contact: ${fullName}`,
            preview: [email, phone, organization].filter(Boolean).join("\n") || fullName,
            confirmText: "Save contact",
          },
          args,
          async () => {
            try {
              const body: Record<string, unknown> = {
                names: [{ givenName, ...(familyName ? { familyName } : {}) }],
              }
              if (email) body["emailAddresses"] = [{ value: email }]
              if (phone) body["phoneNumbers"] = [{ value: phone }]
              if (organization || jobTitle) {
                body["organizations"] = [
                  { ...(organization ? { name: organization } : {}), ...(jobTitle ? { title: jobTitle } : {}) },
                ]
              }
              const created = await peopleApi<Person>(
                `/people:createContact?personFields=${PERSON_FIELDS}`,
                { method: "POST", body: JSON.stringify(body) },
              )
              return { ok: true, ...shapePerson(created, "contacts"), message: "Contact saved." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "contacts-updateContact": tool({
      description:
        "Update an existing contact's email, phone, name, or company. Only the fields you pass are " +
        "changed. Get the contactId from contacts-searchContacts first.",
      parameters: z.object({
        contactId: z.string().describe("Contact resource name from contacts-searchContacts, e.g. people/c12345"),
        givenName: z.string().optional().describe("New first name"),
        familyName: z.string().optional().describe("New last name"),
        email: z.string().optional().describe("New email address (replaces the existing one)"),
        phone: z.string().optional().describe("New phone number (replaces the existing one)"),
        organization: z.string().optional().describe("New company or organization"),
        jobTitle: z.string().optional().describe("New job title"),
      }),
      execute: async (args) => {
        const { contactId, givenName, familyName, email, phone, organization, jobTitle } = args
        return gateWrite(
          ctx,
          {
            connector: "google-contacts",
            action: "contacts-updateContact",
            risk: "write",
            title: `Update contact ${contactId}`,
            preview: [
              givenName || familyName ? `Name: ${[givenName, familyName].filter(Boolean).join(" ")}` : null,
              email ? `Email: ${email}` : null,
              phone ? `Phone: ${phone}` : null,
              organization ? `Org: ${organization}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            confirmText: "Update contact",
          },
          args,
          async () => {
            try {
              const body: Record<string, unknown> = {}
              const fields: string[] = []
              if (givenName !== undefined || familyName !== undefined) {
                body["names"] = [
                  { ...(givenName ? { givenName } : {}), ...(familyName ? { familyName } : {}) },
                ]
                fields.push("names")
              }
              if (email !== undefined) {
                body["emailAddresses"] = [{ value: email }]
                fields.push("emailAddresses")
              }
              if (phone !== undefined) {
                body["phoneNumbers"] = [{ value: phone }]
                fields.push("phoneNumbers")
              }
              if (organization !== undefined || jobTitle !== undefined) {
                body["organizations"] = [
                  { ...(organization ? { name: organization } : {}), ...(jobTitle ? { title: jobTitle } : {}) },
                ]
                fields.push("organizations")
              }
              if (fields.length === 0) return { error: "Nothing to update." }

              // People API rejects an update without the contact's current etag —
              // it is Google's optimistic-concurrency check against a stale overwrite.
              const current = await peopleApi<Person>(`/${contactId}?personFields=names`)
              body["etag"] = current.etag

              const updated = await peopleApi<Person>(
                `/${contactId}:updateContact?updatePersonFields=${fields.join(",")}&personFields=${PERSON_FIELDS}`,
                { method: "PATCH", body: JSON.stringify(body) },
              )
              return { ok: true, ...shapePerson(updated, "contacts"), message: "Contact updated." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "contacts-deleteContact": tool({
      description:
        "Permanently delete a contact from Google Contacts. This cannot be undone.",
      parameters: z.object({
        contactId: z.string().describe("Contact resource name from contacts-searchContacts"),
      }),
      execute: async (args) => {
        const { contactId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-contacts",
            action: "contacts-deleteContact",
            risk: "irreversible",
            title: "Delete a contact permanently",
            preview: `${contactId} will be removed from Google Contacts. This cannot be undone.`,
            confirmText: "Delete contact",
          },
          args,
          async () => {
            try {
              await peopleApi(`/${contactId}:deleteContact`, { method: "DELETE" })
              return { ok: true, message: "Contact deleted." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),
  }
}

export const googleContactsDef: ConnectorDef = {
  id: "google-contacts",
  name: "Google Contacts",
  category: "productivity",
  icon: "google-contacts",
  description:
    "Look up people by name to get their email address, and search, create, or update contacts. Lets Yomi act on 'email Alex' or 'invite Priya' without you typing an address.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // Read + write on saved contacts.
      "https://www.googleapis.com/auth/contacts",
      // "Other contacts" — people the user has emailed but never saved. NOT covered
      // by the contacts scope, and on a personal Gmail it is most of the address book.
      "https://www.googleapis.com/auth/contacts.other.readonly",
      // Workspace org directory. Returns nothing on a personal @gmail.com account.
      "https://www.googleapis.com/auth/directory.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google-contacts",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Use the same Google Cloud project as Gmail (GOOGLE_INTEGRATIONS_CLIENT_ID)",
      "Enable the People API under APIs & Services → Library (NOT the legacy 'Contacts API', which is shut down)",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-contacts",
      "All three contact scopes are sensitive — requires Google brand verification, but no CASA assessment",
    ],
    collect: [
      {
        env: "GOOGLE_INTEGRATIONS_CLIENT_ID",
        label: "Google Client ID (same as Gmail)",
        secret: false,
      },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/people/api/rest",
  },
  tools: createContactsTools,
}
