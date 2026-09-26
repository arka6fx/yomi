import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, ChevronDown, Plus } from "lucide-react"
import { PlanButton } from "@/components/landing/PlanButton"
import { Mascot } from "@/components/Mascot"
import { SitePage } from "@/components/SitePage"
import { formatUsd } from "@/lib/local-price"
import { FREE_ROUTINES, PLANS } from "@/lib/plans"
import { pageMetadata } from "@/lib/site"

export const dynamic = "force-static"

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Yomi is free forever with unlimited chatting and every feature. Pro is $5/month for the smarter engine and unlimited routines.",
  path: "/pricing",
})

// What actually differs between the plans; everything else is the same.
const COMPARE = [
  { label: "chatting on telegram (text, voice, photos)", free: "unlimited", pro: "unlimited" },
  { label: "apps, memory, browsing, research, characters", free: "all of it", pro: "all of it" },
  { label: "routines running in the background", free: `${FREE_ROUTINES}`, pro: "unlimited" },
  { label: "engine", free: "fast", pro: "smarter, thinks longer" },
  { label: "support", free: "email", pro: "priority" },
]

// The same billing facts as the FAQ; keep the two in step.
const QUESTIONS = [
  {
    q: "is free really free?",
    a: `Yes. No card and no trial clock: unlimited chatting, every feature and every app, with ${FREE_ROUTINES} routines running at a time.`,
  },
  {
    q: "what does the smarter engine do?",
    a: "Pro runs yomi's longer jobs with more reasoning, so multi-step work like research, planning or untangling your inbox comes back more careful. Quick replies feel the same on both plans.",
  },
  {
    q: "what counts as a routine?",
    a: `Anything yomi does on a schedule: a morning brief, a sunday reset, a deadline check-in. Free keeps ${FREE_ROUTINES} active at once; pause one to start another, or go pro for unlimited.`,
  },
  {
    q: "how do i pay?",
    a: "By card, through Dodo Payments. Prices are in US dollars; checkout shows your local currency and any tax before you pay.",
  },
  {
    q: "can i cancel?",
    a: "Anytime, from the plan section of your dashboard. You go back to free and keep everything yomi remembers.",
  },
  {
    q: "how do i get pro for free?",
    a: "Invite friends from your dashboard. Each new friend who joins through your link gets you both 3 days of Pro, for up to 20 friends.",
  },
]

// Crosshair marks at the corners of the pricing frame.
function Corner({ className }: { className: string }) {
  return (
    <span aria-hidden className={`absolute size-4 text-foreground/30 ${className}`}>
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-current" />
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-current" />
    </span>
  )
}

export default function PricingPage() {
  return (
    <SitePage>
      <section className="px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <div className="relative mx-auto max-w-6xl border-y border-foreground/10 px-4 py-16 sm:border-x sm:px-10 sm:py-20">
          <Corner className="-left-2 -top-2" />
          <Corner className="-right-2 -top-2" />
          <Corner className="-bottom-2 -left-2" />
          <Corner className="-bottom-2 -right-2" />

          <Mascot
            pose="celebrate"
            priority
            className="mx-auto -mt-28 mb-6 w-28 sm:-mt-32 sm:w-32"
          />
          <h1 className="text-center text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">
            pick your plan
          </h1>
          <p className="mx-auto mt-4 max-w-md text-center text-[17px] text-muted-foreground">
            start free, no card. upgrade when you outgrow it.
          </p>

          <div className="mx-auto mt-14 grid max-w-3xl gap-5 md:grid-cols-2">
            {PLANS.map((plan) => {
              const popular = plan.key === "pro"
              return (
                <div key={plan.key} className="surface flex flex-col p-7">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xl font-semibold lowercase">{plan.name}</p>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold lowercase ${
                        popular ? "bg-foreground text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {plan.badge}
                    </span>
                  </div>
                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="text-5xl font-semibold tracking-[-0.04em]">
                      {formatUsd(plan.priceUsd)}
                    </span>
                    <span className="text-sm text-muted-foreground">{plan.priceSub}</span>
                  </p>
                  <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                    {plan.desc}
                  </p>
                  <ul className="mb-8 mt-5 flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-[15px]">
                        <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-foreground text-white">
                          <Check size={11} strokeWidth={3} />
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <PlanButton
                    planKey={plan.key}
                    label={plan.priceUsd === 0 ? "start free" : `get ${plan.name.toLowerCase()}`}
                    popular={popular}
                  />
                </div>
              )
            })}
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
            prices in US dollars. checkout, run by Dodo Payments, shows your local currency and any
            tax before you pay. no card needed for free. cancel pro anytime from your dashboard.
          </p>

          {/* the comparison stays folded until asked for */}
          <details className="group mx-auto mt-12 max-w-3xl">
            <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-2 rounded-full border border-foreground/15 bg-card px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
              compare free and pro
              <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="surface mt-6 divide-y divide-border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 sm:gap-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                <span />
                <span className="w-16 text-right sm:w-24">free</span>
                <span className="w-16 text-right sm:w-24">pro</span>
              </div>
              {COMPARE.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 sm:gap-4 py-4 sm:px-6"
                >
                  <span className="font-medium">{row.label}</span>
                  <span className="w-16 text-right text-sm text-muted-foreground sm:w-24">
                    {row.free}
                  </span>
                  <span className="w-16 text-right text-sm font-medium sm:w-24">{row.pro}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* referral band */}
        <div className="relative mx-auto mt-20 max-w-6xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#1c9ce8] to-[#8fd0f5] px-6 py-10 text-white sm:px-12 sm:py-12">
          <div className="grid items-center gap-8 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-semibold text-white/80">get pro free</p>
              <h2 className="mt-2 text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">
                invite a friend, you both get 3 days of pro.
              </h2>
              <p className="mt-3 max-w-lg text-[15px] text-white/85">
                share your link from the dashboard. every new friend who joins adds another month,
                for up to 20 friends.
              </p>
              <Link
                href="/dashboard?tab=referrals"
                className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-foreground shadow-sm transition-transform hover:-translate-y-0.5"
              >
                get your invite link <ArrowRight size={15} />
              </Link>
            </div>
            <Mascot pose="heart" float className="mx-auto w-32 sm:w-44" />
          </div>
        </div>

        {/* questions: sticky heading on the left, accordion on the right */}
        <div className="mx-auto mt-24 grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Mascot pose="thinking" className="w-20 sm:w-24" />
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              questions?
            </h2>
            <p className="mt-3 max-w-xs text-[15px] text-muted-foreground">
              the short answers about plans and billing. everything else is in the{" "}
              <Link href="/faq" className="font-medium text-foreground underline">
                faq
              </Link>
              .
            </p>
          </div>
          <div className="divide-y divide-foreground/10 border-y border-foreground/10">
            {QUESTIONS.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Plus
                    size={18}
                    className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
                  />
                </summary>
                <p className="pb-5 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </SitePage>
  )
}
