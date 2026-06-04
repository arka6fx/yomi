import { isBlockedDomain, isDestructiveText } from "../uia/safety.js"
import { emitActResult, requestConfirmation } from "../uia/act-bus.js"

// Browser-MCP safety (Spec 17). Reuses the Act-mode confirm channel: risky browser actions emit
// act_proposed and pause for the user's yes/no, exactly like UIA actions. Read-only tools
// (snapshot, screenshot, wait, tabs, navigate-back) pass through untouched.

type McpTool = { execute: (args: unknown, opts: unknown) => Promise<unknown>; [k: string]: unknown }
type BrowserArgs = {
  element?: string
  text?: string
  url?: string
  values?: unknown
  submit?: boolean
}

// Mutating tools whose target we inspect for destructive intent.
const INSPECTED = new Set([
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
])

function actionLabel(name: string, a: BrowserArgs): string {
  return a.element || a.url || a.text || name.replace(/^browser_/, "")
}

// Decide whether a browser action needs confirmation. Exported for unit tests.
export function classifyBrowserRisk(
  name: string,
  args: unknown,
): { risky: boolean; reason?: string } {
  const a = (args ?? {}) as BrowserArgs
  // File upload always sends data off the machine.
  if (name === "browser_file_upload") return { risky: true, reason: "uploading a file" }
  if (INSPECTED.has(name)) {
    const values = Array.isArray(a.values) ? a.values.map(String) : []
    const text = [a.element, a.text, ...values].filter(Boolean).join(" ")
    if (isDestructiveText(text))
      return { risky: true, reason: `"${a.element || text}" looks destructive` }
  }
  return { risky: false }
}

// Wrap a Playwright-MCP tool set: refuse blocklisted sites, gate risky actions behind confirmation.
export function wrapBrowserTools(tools: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(tools)) {
    const t = raw as McpTool
    if (!name.startsWith("browser_") || typeof t?.execute !== "function") {
      out[name] = raw
      continue
    }
    out[name] = {
      ...t,
      execute: async (args: unknown, opts: unknown) => {
        const a = (args ?? {}) as BrowserArgs
        // Hard refusal: never drive banking / password-manager sites.
        if (name === "browser_navigate" && typeof a.url === "string" && isBlockedDomain(a.url)) {
          return { error: `Refusing to navigate to "${a.url}" — blocklisted site.` }
        }
        const { risky, reason } = classifyBrowserRisk(name, args)
        if (!risky) return t.execute(args, opts)

        const label = actionLabel(name, a)
        const approved = await requestConfirmation(
          { kind: "invoke", ref: name },
          label,
          reason ?? "browser action",
        )
        if (!approved) {
          emitActResult(false, label, "not confirmed")
          return { ok: false, requiresConfirmation: true, label, reason }
        }
        const result = await t.execute(args, opts)
        emitActResult(true, label)
        return result
      },
    }
  }
  return out
}
