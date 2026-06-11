import { nativeProvider } from "./native.js"
// import { browserProvider } from "./browser.js"
import { apiProvider } from "./api.js"
import { workflowProvider } from "./workflow.js"
import type { Provider, ProviderId } from "./types.js"

const providers: Record<ProviderId, Provider> = {
  native: nativeProvider,
  // browser: browserProvider, // will provide later
  api: apiProvider,
  workflow: workflowProvider,
}

export function getProvider(id: ProviderId): Provider {
  return providers[id]
}

export function allProviders(): Provider[] {
  return Object.values(providers)
}
