import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const STRIPE_TOOLKIT = "stripe"

// Real Stripe catalog (33 tools) covers customers, payment intents, invoices,
// subscriptions, products/prices, refunds, and read-only reference data
// (coupons, tax codes/rates, shipping rates, balance). No dispute/payout/
// terminal/climate/radar/sigma actions exist in Composio's catalog.
export const stripeComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "STRIPE_RETRIEVE_BALANCE", description: "Get the current Stripe account balance. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "STRIPE_LIST_CUSTOMERS", description: "List Stripe customers, optionally filtered by email or creation date. Read-only.", parameters: z.object({ email: z.string().optional().describe("Filter by email"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_RETRIEVE_CUSTOMER", description: "Retrieve a specific Stripe customer. Read-only.", parameters: z.object({ customer_id: z.string().describe("Customer ID") }).passthrough() },
  { slug: "STRIPE_SEARCH_CUSTOMERS", description: "Search Stripe customers using Stripe's search query language. Read-only.", parameters: z.object({ query: z.string().describe("Stripe search query") }).passthrough() },
  { slug: "STRIPE_LIST_CUSTOMER_PAYMENT_METHODS", description: "List payment methods for a customer. Read-only.", parameters: z.object({ customer_id: z.string().describe("Customer ID"), type: z.string().optional().describe("Payment method type filter") }).passthrough() },
  { slug: "STRIPE_LIST_CHARGES", description: "List Stripe charges, with filtering and pagination. Read-only.", parameters: z.object({ customer: z.string().optional().describe("Filter by customer ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_RETRIEVE_CHARGE", description: "Retrieve a specific Stripe charge. Read-only.", parameters: z.object({ charge_id: z.string().describe("Charge ID") }).passthrough() },
  { slug: "STRIPE_LIST_PAYMENT_INTENTS", description: "List Stripe payment intents. Read-only.", parameters: z.object({ customer: z.string().optional().describe("Filter by customer ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_RETRIEVE_PAYMENT_INTENT", description: "Retrieve a specific payment intent. Read-only.", parameters: z.object({ payment_intent_id: z.string().describe("PaymentIntent ID") }).passthrough() },
  { slug: "STRIPE_LIST_INVOICES", description: "List Stripe invoices, filterable by customer, subscription, and status. Read-only.", parameters: z.object({ customer: z.string().optional().describe("Filter by customer ID"), status: z.string().optional().describe("Invoice status filter"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_LIST_SUBSCRIPTIONS", description: "List Stripe subscriptions, filterable by customer, price, and status. Read-only.", parameters: z.object({ customer: z.string().optional().describe("Filter by customer ID"), status: z.string().optional().describe("Subscription status filter"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_RETRIEVE_SUBSCRIPTION", description: "Retrieve a specific subscription. Read-only.", parameters: z.object({ subscription_id: z.string().describe("Subscription ID") }).passthrough() },
  { slug: "STRIPE_LIST_PRODUCTS", description: "List Stripe products. Read-only.", parameters: z.object({ active: z.boolean().optional().describe("Filter by active status"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_LIST_PAYMENT_LINKS", description: "List Stripe payment links. Read-only.", parameters: z.object({ active: z.boolean().optional().describe("Filter by active status"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_LIST_REFUNDS", description: "List Stripe refunds. Read-only.", parameters: z.object({ charge: z.string().optional().describe("Filter by charge ID"), payment_intent: z.string().optional().describe("Filter by payment intent ID"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_RETRIEVE_REFUND", description: "Retrieve a specific refund. Read-only.", parameters: z.object({ refund_id: z.string().describe("Refund ID") }).passthrough() },
  { slug: "STRIPE_LIST_COUPONS", description: "List discount coupons. Read-only.", parameters: z.object({ limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_LIST_TAX_CODES", description: "List available Stripe tax codes. Read-only.", parameters: z.object({ limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_LIST_TAX_RATES", description: "List Stripe tax rates. Read-only.", parameters: z.object({ active: z.boolean().optional().describe("Filter by active status"), limit: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "STRIPE_LIST_SHIPPING_RATES", description: "List Stripe shipping rates. Read-only.", parameters: z.object({ active: z.boolean().optional().describe("Filter by active status"), limit: z.number().int().optional().describe("Max results") }).passthrough() },

  // ── Write — gated for approval ──────────────────────────────────
  {
    slug: "STRIPE_CREATE_CUSTOMER",
    description: "Create a new Stripe customer. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().optional().describe("Customer name"), email: z.string().optional().describe("Customer email") }).passthrough(),
    preview: (a) => ({ title: "Create customer", preview: `Create customer "${String(a["name"] ?? a["email"] ?? "")}"`, confirmText: "Create customer" }),
  },
  {
    slug: "STRIPE_UPDATE_CUSTOMER",
    description: "Update an existing Stripe customer. Requires user approval before it runs.",
    parameters: z.object({ customer_id: z.string().describe("Customer ID") }).passthrough(),
    preview: (a) => ({ title: "Update customer", preview: `Update customer ${String(a["customer_id"] ?? "")}`, confirmText: "Update customer" }),
  },
  {
    slug: "STRIPE_CREATE_PAYMENT_INTENT",
    description: "Create a Stripe PaymentIntent to charge a customer. Requires user approval before it runs.",
    parameters: z.object({ amount: z.number().int().describe("Amount in the smallest currency unit"), currency: z.string().describe("Currency code, e.g. 'usd'"), customer: z.string().optional().describe("Customer ID") }).passthrough(),
    preview: (a) => ({ title: "Create payment intent", preview: `Charge ${String(a["amount"] ?? "")} ${String(a["currency"] ?? "")}`, confirmText: "Create" }),
  },
  {
    slug: "STRIPE_UPDATE_PAYMENT_INTENT",
    description: "Update a Stripe PaymentIntent. Requires user approval before it runs.",
    parameters: z.object({ payment_intent_id: z.string().describe("PaymentIntent ID") }).passthrough(),
    preview: (a) => ({ title: "Update payment intent", preview: `Update ${String(a["payment_intent_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "STRIPE_CONFIRM_PAYMENT_INTENT",
    description: "Confirm a Stripe PaymentIntent to finalize a payment. Requires user approval before it runs.",
    parameters: z.object({ payment_intent_id: z.string().describe("PaymentIntent ID") }).passthrough(),
    preview: (a) => ({ title: "Confirm payment intent", preview: `Confirm ${String(a["payment_intent_id"] ?? "")}`, confirmText: "Confirm" }),
  },
  {
    slug: "STRIPE_CREATE_PRODUCT",
    description: "Create a new Stripe product. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Product name") }).passthrough(),
    preview: (a) => ({ title: "Create product", preview: `Create product "${String(a["name"] ?? "")}"`, confirmText: "Create product" }),
  },
  {
    slug: "STRIPE_CREATE_PRICE",
    description: "Create a new Stripe price for a product. Requires user approval before it runs.",
    parameters: z.object({ product: z.string().optional().describe("Product ID"), currency: z.string().describe("Currency code"), unit_amount: z.number().int().optional().describe("Amount in smallest currency unit") }).passthrough(),
    preview: (a) => ({ title: "Create price", preview: `Create price for ${String(a["product"] ?? "")}`, confirmText: "Create price" }),
  },
  {
    slug: "STRIPE_CREATE_INVOICE",
    description: "Create a new draft Stripe invoice for a customer. Requires user approval before it runs.",
    parameters: z.object({ customer: z.string().describe("Customer ID"), description: z.string().optional().describe("Invoice description") }).passthrough(),
    preview: (a) => ({ title: "Create invoice", preview: `Create invoice for ${String(a["customer"] ?? "")}`, confirmText: "Create invoice" }),
  },
  {
    slug: "STRIPE_CREATE_SUBSCRIPTION",
    description: "Create a new Stripe subscription for a customer. Requires user approval before it runs.",
    parameters: z.object({ customer: z.string().describe("Customer ID"), items: z.array(z.record(z.string(), z.unknown())).describe("Subscription items (price IDs, quantities)") }).passthrough(),
    preview: (a) => ({ title: "Create subscription", preview: `Create subscription for ${String(a["customer"] ?? "")}`, confirmText: "Create subscription" }),
  },
  {
    slug: "STRIPE_UPDATE_SUBSCRIPTION",
    description: "Update an existing Stripe subscription. Requires user approval before it runs.",
    parameters: z.object({ subscription_id: z.string().describe("Subscription ID") }).passthrough(),
    preview: (a) => ({ title: "Update subscription", preview: `Update subscription ${String(a["subscription_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "STRIPE_CREATE_REFUND",
    description: "Create a full or partial refund for a charge or payment intent. Money movement — requires user approval before it runs.",
    parameters: z.object({ charge: z.string().optional().describe("Charge ID"), payment_intent: z.string().optional().describe("PaymentIntent ID"), amount: z.number().int().optional().describe("Refund amount (defaults to full amount)") }).passthrough(),
    preview: (a) => ({ title: "Create refund", preview: `Refund ${String(a["charge"] ?? a["payment_intent"] ?? "")}`, confirmText: "Refund" }),
  },
  {
    slug: "STRIPE_CANCEL_SUBSCRIPTION",
    description: "Cancel a customer's active subscription. This cannot be undone.",
    parameters: z.object({ subscription_id: z.string().describe("Subscription ID"), invoice_now: z.boolean().optional().describe("Invoice immediately for outstanding charges") }).passthrough(),
    preview: (a) => ({ title: "Cancel subscription", preview: `Cancel subscription ${String(a["subscription_id"] ?? "")} — this cannot be undone`, confirmText: "Cancel subscription" }),
  },
  {
    slug: "STRIPE_DELETE_CUSTOMER",
    description: "Permanently delete a Stripe customer. This cancels active subscriptions too. This cannot be undone.",
    parameters: z.object({ customer_id: z.string().describe("Customer ID") }).passthrough(),
    preview: (a) => ({ title: "Delete customer", preview: `Delete customer ${String(a["customer_id"] ?? "")} — this cannot be undone`, confirmText: "Delete customer" }),
  },
]

export function makeComposioStripeDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "stripe",
    name: "Stripe",
    category: "finance",
    icon: "stripe",
    description: "Stripe — manage customers, payment intents, invoices, subscriptions, products, prices, and refunds (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: STRIPE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_STRIPE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://dashboard.stripe.com/apikeys",
      steps: [
        "Create a Stripe auth config in Composio (uses API key auth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_STRIPE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=stripe to route Stripe through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_STRIPE_AUTH_CONFIG_ID", label: "Composio Stripe auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/stripe",
    },
    tools: createComposioTools({
      provider: "stripe",
      toolkit: STRIPE_TOOLKIT,
      specs: stripeComposioSpecs,
      executor,
    }),
  }
}
