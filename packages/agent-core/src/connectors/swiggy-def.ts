import type { ToolExecutionOptions, ToolSet } from "ai"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { gateWrite } from "./connector-def.js"
import type { MCPAuthProvider } from "./mcp-connector.js"

export const SWIGGY_MCP_SERVERS = [
  { id: "food", url: "https://mcp.swiggy.com/food" },
  { id: "im", url: "https://mcp.swiggy.com/im" },
  { id: "dineout", url: "https://mcp.swiggy.com/dineout" },
] as const

// Tools that place orders and need Telegram approval via gateWrite.
const ORDER_TOOLS = new Set(["place_food_order", "checkout", "book_table"])

// Tools that read order status (read-only, no gate).
const TRACK_TOOLS = new Set([
  "track_food_order",
  "get_food_orders",
  "get_food_order_details",
  "get_orders",
  "get_order_details",
  "track_order",
  "get_booking_status",
])

function getOrderTitle(toolName: string): string {
  const titles: Record<string, string> = {
    place_food_order: "Place food order",
    checkout: "Checkout Instamart order",
    book_table: "Book Dineout table",
  }
  return titles[toolName] ?? `Execute ${toolName}`
}

function getOrderPreview(toolName: string, args: unknown): string {
  const a = args as Record<string, unknown>
  switch (toolName) {
    case "place_food_order":
      return `Place order at restaurant`
    case "checkout":
      return `Checkout Instamart cart`
    case "book_table": {
      const previewParts = ["Book table"]
      if (a.restaurant_id ?? a.restaurantId) previewParts.push(`at ${a.restaurant_id ?? a.restaurantId}`)
      if (a.party_size ?? a.partySize) previewParts.push(`for ${a.party_size ?? a.partySize}`)
      if (a.date_time ?? a.date ?? a.datetime) previewParts.push(`on ${a.date_time ?? a.date ?? a.datetime}`)
      return previewParts.join(" ")
    }
    default:
      return `Execute ${toolName}`
  }
}

export function wrapOrderTools(tools: ToolSet, ctx: ConnectorContext): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (ORDER_TOOLS.has(name) && tool.execute) {
      const originalExecute = tool.execute
      wrapped[name] = {
        ...tool,
        execute: async (
          args: unknown,
          options?: ToolExecutionOptions,
        ) => {
          // Dineout: only free reservations are supported in v1 (Swiggy constraint).
          if (name === "book_table") {
            const a = args as Record<string, unknown>
            if (a.isFree !== true && a.is_free !== true) {
              return {
                error:
                  "Only free reservations are supported. " +
                  "Use a restaurant that offers free table booking.",
              }
            }
          }

          return gateWrite<unknown>(
            ctx,
            {
              connector: "swiggy",
              action: name,
              risk: "paid",
              title: getOrderTitle(name),
              preview: getOrderPreview(name, args),
            },
            args,
            () =>
              options
                ? originalExecute(args, options)
                : (originalExecute as (args: unknown) => PromiseLike<unknown>)(args),
          )
        },
      }
    } else {
      wrapped[name] = tool
    }
  }
  return wrapped
}

export const swiggyDef: ConnectorDef = {
  id: "swiggy",
  name: "Swiggy",
  category: "food",
  icon: "🍽️",
  description: "Food delivery, groceries, and restaurant reservations",
  auth: {
    kind: "oauth2",
    authUrl: "https://mcp.swiggy.com/auth/authorize",
    tokenUrl: "https://mcp.swiggy.com/auth/token",
    scopes: [],
    clientIdEnv: "SWIGGY_CLIENT_ID",
    clientSecretEnv: "SWIGGY_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/swiggy",
    pkce: true,
    extraAuthParams: {
      response_type: "code",
    },
  },
  setup: {
    providerConsoleUrl: "https://builders.swiggy.com",
    steps: [
      "Click 'Connect' to link your Swiggy account.",
      "Complete the OAuth flow (phone + OTP) in the browser.",
      "Return to Yomi — your Swiggy connection is ready.",
    ],
    collect: [],
    docsUrl: "https://builders.swiggy.com/docs",
  },
  tools: () => ({}),
  readOnlyByDefault: false,
  isMCPBased: true,
  connectMCP: async (ctx: ConnectorContext): Promise<ToolSet> => {
    const { createMCPToolProvider } = await import("./mcp-connector.js")
    const provider = createMCPToolProvider()

    const authProvider = {
      async getHeaders() {
        const token = await ctx.getAccessToken(ctx.userId, "swiggy")
        return { Authorization: `Bearer ${token}` }
      },
      async onUnauthorized() {
        const token = await ctx.getAccessToken(ctx.userId, "swiggy")
        return { Authorization: `Bearer ${token}` }
      },
    }

    const tools = await provider.loadTools({
      userId: ctx.userId,
      servers: [...SWIGGY_MCP_SERVERS],
      authProvider,
    })

    return wrapOrderTools(tools, ctx)
  },
}
