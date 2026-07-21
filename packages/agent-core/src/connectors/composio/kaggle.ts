import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const KAGGLE_TOOLKIT = "kaggle"

// Kaggle's Composio toolkit covers datasets, dataset files, competition
// submission/download, and kernel status — there is no generic "list
// competitions/models/kernels" action.
export const kaggleComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "KAGGLE_LIST_DATASETS",
    description: "Search and list datasets on Kaggle. Read-only.",
    parameters: z.object({
      search: z.string().optional().describe("Search query"),
      user: z.string().optional().describe("Filter by dataset owner"),
      sort_by: z.string().optional().describe("Sort by: 'hottest', 'votes', 'updated', 'active'"),
      page: z.number().int().optional().describe("Page number"),
    }).passthrough(),
  },
  {
    slug: "KAGGLE_DATASET_STATUS",
    description: "Get the processing status of a dataset. Read-only.",
    parameters: z.object({ owner_slug: z.string().describe("Dataset owner"), dataset_slug: z.string().describe("Dataset slug") }).passthrough(),
  },
  {
    slug: "KAGGLE_KAGGLE_DATASET_LIST_FILES",
    description: "List files in a Kaggle dataset. Read-only.",
    parameters: z.object({
      owner_slug: z.string().describe("Dataset owner"),
      dataset_slug: z.string().describe("Dataset slug"),
      page_size: z.number().int().optional().describe("Results per page"),
    }).passthrough(),
  },
  {
    slug: "KAGGLE_KERNELS_STATUS",
    description: "Get the run status of a Kaggle kernel/notebook. Read-only.",
    parameters: z.object({ userName: z.string().describe("Kernel owner username"), kernelSlug: z.string().describe("Kernel slug") }).passthrough(),
  },
  {
    slug: "KAGGLE_COMPETITION_DOWNLOAD_FILES",
    description: "Download a competition's data files. Read-only.",
    parameters: z.object({ id: z.string().describe("Competition ID"), path: z.string().optional().describe("Destination path") }).passthrough(),
  },
  {
    slug: "KAGGLE_DATASET_CREATE",
    description: "Create a new Kaggle dataset with metadata. Requires approval.",
    parameters: z.object({
      id: z.string().describe("Dataset id ('owner/slug')"),
      title: z.string().describe("Dataset title"),
      licenses: z.array(z.string()).describe("License identifiers"),
      description: z.string().optional().describe("Dataset description"),
    }).passthrough(),
    preview: (a) => ({
      title: "Create Kaggle dataset",
      preview: `Create dataset "${String(a["title"] ?? "")}"`,
      confirmText: "Create dataset",
    }),
  },
  {
    slug: "KAGGLE_DATASET_VERSION",
    description: "Create a new version of an existing dataset. Requires approval.",
    parameters: z.object({
      owner_slug: z.string().describe("Dataset owner"),
      dataset_slug: z.string().describe("Dataset slug"),
      version_notes: z.string().describe("Notes describing this version"),
    }).passthrough(),
    preview: (a) => ({
      title: "Create dataset version",
      preview: `New version for ${String(a["owner_slug"] ?? "")}/${String(a["dataset_slug"] ?? "")}`,
      confirmText: "Create version",
    }),
  },
  {
    slug: "KAGGLE_KAGGLE_COMPETITION_SUBMIT",
    description: "Submit a prediction file to a competition. Requires approval.",
    parameters: z.object({
      competition: z.string().describe("Competition name"),
      blob_file_tokens: z.string().describe("Uploaded submission file token"),
      submission_description: z.string().describe("Submission description"),
    }).passthrough(),
    preview: (a) => ({
      title: "Submit to competition",
      preview: `Submit to ${String(a["competition"] ?? "")}`,
      confirmText: "Submit",
    }),
  },
]

export function makeComposioKaggleDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "kaggle",
    name: "Kaggle",
    category: "data",
    icon: "kaggle",
    description: "Kaggle — search datasets, inspect dataset/kernel status, and submit to competitions (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: KAGGLE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_KAGGLE_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://www.kaggle.com",
      steps: [
        "Create a Kaggle auth config in Composio with your Kaggle API token",
        "Set COMPOSIO_API_KEY and COMPOSIO_KAGGLE_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=kaggle to route Kaggle through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_KAGGLE_AUTH_CONFIG_ID", label: "Composio Kaggle auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/kaggle",
    },
    tools: createComposioTools({
      provider: "kaggle",
      toolkit: KAGGLE_TOOLKIT,
      specs: kaggleComposioSpecs,
      executor,
    }),
  }
}
