import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GOOGLE_CLOUD_VISION_TOOLKIT = "google_cloud_vision"

// Composio's Google Cloud Vision toolkit is the Product Search API (catalog
// products/product sets/reference images) plus generic project/operation
// listing — there is no generic label/OCR/face-detection action here.
export const googleCloudVisionComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "GOOGLE_CLOUD_VISION_VISION_LIST_PROJECTS",
    description: "List Google Cloud projects accessible by the authenticated user. Read-only.",
    parameters: z
      .object({ pageSize: z.number().int().optional().describe("Max results per page") })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_GET_PRODUCT",
    description: "Get details of a Product Search product. Read-only.",
    parameters: z.object({ name: z.string().describe("Product resource name") }).passthrough(),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_GET_PRODUCT_SET",
    description: "Get details of a Product Search product set. Read-only.",
    parameters: z.object({ name: z.string().describe("Product set resource name") }).passthrough(),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_VISION_LIST_PRODUCTS_IN_PRODUCT_SET",
    description: "List the products in a product set. Read-only.",
    parameters: z
      .object({
        name: z.string().describe("Product set resource name"),
        pageSize: z.number().int().optional().describe("Max results per page"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_VISION_LIST_REFERENCE_IMAGES",
    description: "List reference images for a product. Read-only.",
    parameters: z
      .object({
        parent: z.string().describe("Product resource name"),
        pageSize: z.number().int().optional().describe("Max results per page"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_LIST_OPERATIONS",
    description: "List long-running Vision API operations matching a filter. Read-only.",
    parameters: z
      .object({
        name: z.string().describe("Parent resource name"),
        filter: z.string().optional().describe("Operation filter"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_CREATE_PRODUCT",
    description: "Register a new Product Search product. Requires approval.",
    parameters: z
      .object({
        parent: z.string().describe("Parent resource name (project/location)"),
        displayName: z.string().describe("Product display name"),
        productCategory: z.string().describe("Product category, e.g. 'apparel-v2'"),
        description: z.string().optional().describe("Product description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create product",
      preview: `Create product "${String(a["displayName"] ?? "")}"`,
      confirmText: "Create product",
    }),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_CREATE_REFERENCE_IMAGE",
    description: "Add a reference image to a product. Requires approval.",
    parameters: z
      .object({
        parent: z.string().describe("Product resource name"),
        uri: z.string().describe("GCS URI of the reference image"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add reference image",
      preview: `Add ${String(a["uri"] ?? "")} to ${String(a["parent"] ?? "")}`,
      confirmText: "Add image",
    }),
  },
  {
    slug: "GOOGLE_CLOUD_VISION_DELETE_PRODUCT",
    description: "Permanently delete a product and its reference images. Irreversible.",
    parameters: z.object({ name: z.string().describe("Product resource name") }).passthrough(),
    preview: (a) => ({
      title: "Delete product",
      preview: `Delete product ${String(a["name"] ?? "")}`,
      confirmText: "Delete product",
    }),
  },
]

export function makeComposioGoogleCloudVisionDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-cloud-vision",
    name: "Google Cloud Vision",
    category: "data",
    icon: "google-cloud-vision",
    description:
      "Google Cloud Vision — manage Product Search catalogs (products, product sets, reference images) for visual product search (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: GOOGLE_CLOUD_VISION_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GOOGLE_CLOUD_VISION_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Google Cloud Vision auth config in Composio (API key)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GOOGLE_CLOUD_VISION_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-cloud-vision to route Google Cloud Vision through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_GOOGLE_CLOUD_VISION_AUTH_CONFIG_ID",
          label: "Composio Google Cloud Vision auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/google_cloud_vision",
    },
    tools: createComposioTools({
      provider: "google-cloud-vision",
      toolkit: GOOGLE_CLOUD_VISION_TOOLKIT,
      specs: googleCloudVisionComposioSpecs,
      executor,
    }),
  }
}
