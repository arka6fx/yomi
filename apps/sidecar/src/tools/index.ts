import type { Plan } from "@yomi/shared"
import { createMemoryTools } from "./memory.js"
import { createSystemTools } from "./system.js"
import { createWebTools } from "./web.js"
// import { createUiaAdvancedTools } from "./uia-advanced.js"
import { createSkillTools } from "./skills/index.js"
import { createDelegateTaskTool } from "../subagent/delegate-tool.js"
import { createCronJobTool } from "./cron/cronjob-tool.js"
import { createMessagingTools } from "./messaging.js"
import { getDefaultPluginManager } from "../plugins/plugin-manager.js"

export interface AgentToolsContext {
  screenshotB64?: string
  plan?: Plan | undefined
}

export function createAgentTools(ctx: AgentToolsContext = {}) {
  return {
    ...createMemoryTools(),
    ...createSystemTools(ctx),
    ...createWebTools(),
    // ...createUiaAdvancedTools(),
    ...createSkillTools({ plan: ctx.plan }),
    ...createDelegateTaskTool({ plan: ctx.plan }),
    ...createCronJobTool({ plan: ctx.plan }),
    ...createMessagingTools(),
    ...getDefaultPluginManager().getTools(),
  }
}
