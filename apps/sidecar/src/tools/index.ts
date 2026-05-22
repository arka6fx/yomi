import { createMemoryTools } from "./memory.js"
import { createSystemTools } from "./system.js"
import { createWebTools } from "./web.js"

export function createAgentTools(ctx: { screenshotB64?: string }) {
  return {
    ...createMemoryTools(),
    ...createSystemTools(ctx),
    ...createWebTools(),
  }
}
