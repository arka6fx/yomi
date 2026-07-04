import type { Plan } from "@yomi/shared"
import { createMemoryTools } from "./memory.js"
import { createSystemTools } from "./system.js"
import { createWebTools } from "./web.js"
import { createDelegateTaskTool } from "../subagent/delegate-tool.js"
import { createCronJobTool } from "./cron/cronjob-tool.js"
import { createMessagingTools } from "./messaging.js"
import { createIntegrationTools } from "./integrations.js"
import { createDocumentTools } from "./documents.js"
import { getConnectorRegistry } from "../connectors/registry.js"

export interface AgentToolsContext {
  screenshotB64?: string
  plan?: Plan | undefined
}

export function createAgentTools(ctx: AgentToolsContext = {}) {
  return {
    ...createMemoryTools(),
    ...createSystemTools(ctx),
    ...createWebTools(),
    ...createDelegateTaskTool({ plan: ctx.plan }),
    ...createCronJobTool({ plan: ctx.plan }),
    ...createMessagingTools(),
    ...createIntegrationTools(),
    ...createDocumentTools(),
    ...getConnectorRegistry().getAllDefTools(),
  }
}
