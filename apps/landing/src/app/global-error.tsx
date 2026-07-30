"use client"

import { pageTitle } from "@/lib/site"
import "./globals.css"

// This replaces the root layout rather than rendering inside it, so it owns the whole
// document and cannot export metadata — the <title> below is rendered into the tree and
// react hoists it. Without it the tab reads next's stock "500: This page couldn't load".
// For the same reason nothing here may depend on Providers or the layout's font
// variables; globals.css declares literal family fallbacks, so the type still lands.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>{pageTitle("Something went wrong")}</title>
        <div className="landing-light site-texture-bg-light flex min-h-dvh flex-col items-center justify-center px-6 text-foreground">
          <p className="mb-3 font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            500
          </p>
          <h1 className="font-accent text-center text-5xl text-foreground sm:text-6xl">
            Something went wrong.
          </h1>
          <p className="mt-5 max-w-xl text-center text-base leading-8 text-muted-foreground">
            This one is on us. Try again — and if it keeps happening, tell us at{" "}
            <a className="text-primary hover:underline" href="/support">
              getyomi.in/support
            </a>
            . Yomi on Telegram is unaffected.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={reset}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Try again
            </button>
            {/* a plain anchor, not next/link — routing is what just failed */}
            <a
              href="/"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-card/60 px-5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-card/80"
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
