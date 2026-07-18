import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CONTACTS_TOOLKIT = "googlecontacts"

export const contactsComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLECONTACTS_SEARCH_CONTACTS",
    description:
      "Search the user's Google Contacts by name, email, or phone. Returns matching contact records with names, emails, and phone numbers. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search text — a name, email, or phone number"),
        page_size: z.number().int().min(1).max(30).optional().describe("Max results to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECONTACTS_LIST_CONTACTS",
    description:
      "List the user's saved contacts. Use this only for 'show me my contacts' — to find one specific person, use GOOGLECONTACTS_SEARCH_CONTACTS instead. Read-only.",
    parameters: z
      .object({
        page_size: z.number().int().min(1).max(100).optional().describe("Max contacts to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLECONTACTS_GET_CONTACT",
    description:
      "Get one contact's full details by resource ID. Read-only.",
    parameters: z
      .object({
        contact_id: z.string().describe("Contact resource name, e.g. people/c12345"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLECONTACTS_CREATE_CONTACT",
    description:
      "Save a new contact to Google Contacts. Requires user approval before it runs.",
    parameters: z
      .object({
        given_name: z.string().describe("First name"),
        family_name: z.string().optional().describe("Last name"),
        email: z.string().optional().describe("Email address"),
        phone: z.string().optional().describe("Phone number"),
        organization: z.string().optional().describe("Company or organization"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Save contact: ${[a["given_name"], a["family_name"]].filter(Boolean).join(" ")}`,
      preview: [a["email"], a["phone"], a["organization"]].filter(Boolean).join("\n") || "New contact",
      confirmText: "Save contact",
    }),
  },
  {
    slug: "GOOGLECONTACTS_UPDATE_CONTACT",
    description:
      "Update an existing contact's email, phone, name, or organization. Only the fields you pass are changed. Requires user approval before it runs.",
    parameters: z
      .object({
        contact_id: z.string().describe("Contact resource name"),
        given_name: z.string().optional().describe("New first name"),
        family_name: z.string().optional().describe("New last name"),
        email: z.string().optional().describe("New email address"),
        phone: z.string().optional().describe("New phone number"),
        organization: z.string().optional().describe("New organization"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update contact ${String(a["contact_id"] ?? "").slice(0, 16)}`,
      preview: [
        a["email"] ? `Email: ${String(a["email"])}` : null,
        a["phone"] ? `Phone: ${String(a["phone"])}` : null,
      ].filter(Boolean).join("\n") || "Update contact details",
      confirmText: "Update contact",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLECONTACTS_DELETE_CONTACT",
    description:
      "Permanently delete a contact from Google Contacts. This cannot be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        contact_id: z.string().describe("Contact resource name to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete contact permanently",
      preview: `Delete contact ${String(a["contact_id"] ?? "").slice(0, 16)}. This cannot be undone.`,
      confirmText: "Delete contact",
    }),
  },
]

export function makeComposioContactsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-contacts",
    name: "Google Contacts",
    category: "productivity",
    icon: "google-contacts",
    description: "Search, create, and update Google Contacts (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: CONTACTS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CONTACTS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_CONTACTS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-contacts to route Contacts through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_CONTACTS_AUTH_CONFIG_ID", label: "Composio Contacts auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googlecontacts",
    },
    tools: createComposioTools({
      provider: "google-contacts",
      toolkit: CONTACTS_TOOLKIT,
      specs: contactsComposioSpecs,
      executor,
    }),
  }
}
