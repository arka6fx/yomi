"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { ConnectorIcon } from "@yomi/ui-connectors"

// A client island purely because the labels and hrefs depend on the session. The rest of
// the landing page is static, so it renders on the server and ships no JS.
export function HeroActions() {
  const { data: session } = authClient.useSession()

  return (
    <div className="grid w-full max-w-md grid-cols-2 gap-3">
      <Link
        href={session ? "/dashboard" : "/signup"}
        className="group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
      >
        {session ? "Go to dashboard" : "Get started"}
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-foreground text-primary transition group-hover:translate-x-0.5">
          <ArrowRight size={14} />
        </span>
      </Link>
      {/* was a button calling scrollIntoView; html already sets scroll-behavior: smooth,
          so a plain anchor gets the same result and works without JS */}
      <a
        href="#how-it-works"
        className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-border bg-card/60 px-5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-card/80"
      >
        See how it works
      </a>
      <Link
        // Signed-in users go straight to the Telegram connect flow;
        // signup's callbackURL already sends new users there too, so
        // this used to hard-code /signup and re-prompt already
        // logged-in users to sign up all over again.
        href={session ? "/link" : "/signup"}
        className="col-span-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-card/80"
      >
        <ConnectorIcon id="telegram" size={17} />
        Text Yomi
      </Link>
    </div>
  )
}
