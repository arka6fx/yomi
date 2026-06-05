import { platform } from "node:os"
import { uia } from "../../uia/client.js"
import type { Provider, ProviderHealth, UiaPort } from "./types.js"

// NativeAutomationProvider: Windows app control via the UIA helper. healthCheck/repair both prod a
// getWindowInfo round-trip — the UIA client respawns the helper on next call if it died, so a
// successful round-trip after a crash *is* the repair.
export function createNativeProvider(port: UiaPort = uia): Provider {
  async function probe(): Promise<ProviderHealth> {
    if (platform() !== "win32") return { ok: false, detail: "native automation requires Windows" }
    try {
      const info = await port.getWindowInfo()
      return { ok: true, detail: `uia-helper responsive; foreground "${info.window || "unknown"}"` }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "uia-helper unreachable" }
    }
  }
  return {
    id: "native",
    label: "Native Automation",
    healthCheck: probe,
    async diagnostics() {
      const health = await probe()
      return {
        platform: platform(),
        helper: process.env.YOMI_UIA_HELPER ?? "(bundled)",
        healthy: health.ok,
        detail: health.detail,
      }
    },
    repair: probe,
  }
}

export const nativeProvider = createNativeProvider()
