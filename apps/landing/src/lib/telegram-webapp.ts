declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string
        ready?: () => void
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void
      }
    }
  }
}

// True only inside a real Telegram Mini App webview — initData is populated
// by the Telegram client itself, so this can't be spoofed by just loading the
// SDK script standalone.
export function isTelegramMiniApp(): boolean {
  return typeof window !== "undefined" && !!window.Telegram?.WebApp?.initData
}

// Callers that need to branch on whether openLink() is usable (rather than
// just wanting the best-effort navigation openExternal() gives them) should
// check this first — e.g. flows built around a single-use token, where
// falling through to a same-tab `window.location.href` navigation would burn
// the token in the wrong browser context instead of leaving it untouched.
export function isTelegramOpenLinkAvailable(): boolean {
  return isTelegramMiniApp() && !!window.Telegram?.WebApp?.openLink
}

// Google (and some other OAuth providers) refuse to complete sign-in when the
// page is loaded inside an embedded webview — Telegram's Mini App surface is
// exactly that. openLink() escapes to a real external browser instead of
// navigating the mini-app's own iframe/webview in place, which is what a
// plain `window.location.href` assignment would otherwise do here.
export function openExternal(url: string): void {
  if (isTelegramOpenLinkAvailable() && window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url, { try_instant_view: false })
  } else {
    window.location.href = url
  }
}
