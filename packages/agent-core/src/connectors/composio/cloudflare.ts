import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const CLOUDFLARE_TOOLKIT = "cloudflare"

export const cloudflareComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "CLOUDFLARE_LIST_ACCOUNTS", description: "List Cloudflare accounts accessible to the user. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "CLOUDFLARE_LIST_ZONES", description: "List, search, and filter zones (domains). Read-only.", parameters: z.object({ name: z.string().optional().describe("Filter by zone name"), status: z.string().optional().describe("Filter by status") }).passthrough() },
  { slug: "CLOUDFLARE_LIST_FIREWALL_RULES", description: "List firewall rules for a zone. Read-only.", parameters: z.object({ zone_id: z.string().describe("Zone ID") }).passthrough() },
  { slug: "CLOUDFLARE_LIST_ACCOUNT_MEMBERS", description: "List members of an account. Read-only.", parameters: z.object({ account_id: z.string().describe("Account ID") }).passthrough() },
  { slug: "CLOUDFLARE_GET_LISTS", description: "List WAF lists for an account. Read-only.", parameters: z.object({ account_id: z.string().describe("Account ID") }).passthrough() },
  { slug: "CLOUDFLARE_LIST_MONITORS", description: "List load-balancer monitors for an account. Read-only.", parameters: z.object({ account_id: z.string().describe("Account ID") }).passthrough() },
  { slug: "CLOUDFLARE_LIST_POOLS", description: "List load-balancer pools for an account. Read-only.", parameters: z.object({ account_id: z.string().describe("Account ID") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "CLOUDFLARE_CREATE_ZONE",
    description: "Add a new zone (domain) to Cloudflare. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Domain name"), account: z.record(z.string(), z.unknown()).optional().describe("Account reference") }).passthrough(),
    preview: (a) => ({ title: "Create zone", preview: `Add zone "${String(a["name"] ?? "")}"`, confirmText: "Add zone" }),
  },
  {
    slug: "CLOUDFLARE_UPDATE_ZONE",
    description: "Update zone properties (e.g. pause/unpause). Requires user approval before it runs.",
    parameters: z.object({ zone_id: z.string().describe("Zone ID") }).passthrough(),
    preview: (a) => ({ title: "Update zone", preview: `Update zone ${String(a["zone_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "CLOUDFLARE_CREATE_DNS_RECORD",
    description: "Create a new DNS record in a zone. Requires user approval before it runs.",
    parameters: z.object({ zone_identifier: z.string().describe("Zone ID"), type: z.string().describe("Record type, e.g. 'A', 'CNAME'"), name: z.string().describe("Record name"), content: z.string().describe("Record content") }).passthrough(),
    preview: (a) => ({ title: "Create DNS record", preview: `Create ${String(a["type"] ?? "")} record "${String(a["name"] ?? "")}"`, confirmText: "Create record" }),
  },
  {
    slug: "CLOUDFLARE_UPDATE_DNS_RECORD",
    description: "Update an existing DNS record. Requires user approval before it runs.",
    parameters: z.object({ zone_identifier: z.string().describe("Zone ID"), identifier: z.string().describe("Record ID"), type: z.string().describe("Record type"), name: z.string().describe("Record name"), content: z.string().describe("Record content") }).passthrough(),
    preview: (a) => ({ title: "Update DNS record", preview: `Update record ${String(a["identifier"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "CLOUDFLARE_CREATE_LIST",
    description: "Create a new empty WAF list for an account. Requires user approval before it runs.",
    parameters: z.object({ account_id: z.string().describe("Account ID"), name: z.string().describe("List name"), kind: z.string().describe("List kind, e.g. 'ip'") }).passthrough(),
    preview: (a) => ({ title: "Create WAF list", preview: `Create list "${String(a["name"] ?? "")}"`, confirmText: "Create list" }),
  },
  {
    slug: "CLOUDFLARE_UPDATE_LIST",
    description: "Update a WAF list's description. Requires user approval before it runs.",
    parameters: z.object({ account_id: z.string().describe("Account ID"), list_id: z.string().describe("List ID"), description: z.string().describe("New description") }).passthrough(),
    preview: (a) => ({ title: "Update WAF list", preview: `Update list ${String(a["list_id"] ?? "")}`, confirmText: "Update" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "CLOUDFLARE_DELETE_ZONE",
    description: "Permanently remove a zone from Cloudflare. This cannot be undone.",
    parameters: z.object({ zone_identifier: z.string().describe("Zone ID") }).passthrough(),
    preview: (a) => ({ title: "Delete zone", preview: `Delete zone ${String(a["zone_identifier"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "CLOUDFLARE_DELETE_DNS_RECORD",
    description: "Permanently delete a DNS record. This cannot be undone.",
    parameters: z.object({ zone_identifier: z.string().describe("Zone ID"), identifier: z.string().describe("Record ID") }).passthrough(),
    preview: (a) => ({ title: "Delete DNS record", preview: `Delete record ${String(a["identifier"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "CLOUDFLARE_DELETE_LIST",
    description: "Permanently delete a WAF list. This cannot be undone.",
    parameters: z.object({ account_id: z.string().describe("Account ID"), list_id: z.string().describe("List ID") }).passthrough(),
    preview: (a) => ({ title: "Delete WAF list", preview: `Delete list ${String(a["list_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioCloudflareDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "cloudflare",
    name: "Cloudflare",
    category: "developer",
    icon: "cloudflare",
    description: "Cloudflare — manage zones, DNS records, WAF lists, firewall rules, and load balancing (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: CLOUDFLARE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CLOUDFLARE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://dash.cloudflare.com/profile/api-tokens",
      steps: [
        "Create a Cloudflare auth config in Composio (uses API key/token auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_CLOUDFLARE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=cloudflare to route Cloudflare through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_CLOUDFLARE_AUTH_CONFIG_ID", label: "Composio Cloudflare auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/cloudflare",
    },
    tools: createComposioTools({
      provider: "cloudflare",
      toolkit: CLOUDFLARE_TOOLKIT,
      specs: cloudflareComposioSpecs,
      executor,
    }),
  }
}
