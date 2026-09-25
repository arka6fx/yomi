import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { PlanButton } from "@/components/landing/PlanButton"
import { SitePage } from "@/components/SitePage"
import { formatUsd } from "@/lib/local-price"
import { PLANS } from "@/lib/plans"
import { pageMetadata } from "@/lib/site"

export const dynamic = "force-static"

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Yomi is free every month with 100 credits. Pro is $5/month for 300 credits and Max is $40/month for 750. Unlimited app connectors on every plan.",
  path: "/pricing",
})

// Mirrors CREDIT_COSTS in apps/api/src/yomi/services/credit_pricing.py.
const COSTS = [
  { label: "a message to yomi on telegram", credits: "3 credits" },
  { label: "voice note", credits: "2 credits / min" },
  { label: "photo analysis", credits: "1 credit" },
  { label: "each action in an add-on app (Docs, Sheets, Zoom…)", credits: "+1 credit" },
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

          <h1 className="text-center text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">
            pick your plan
          </h1>
          <p className="mx-auto mt-4 max-w-md text-center text-[17px] text-muted-foreground">
            start free, no card. upgrade when you outgrow it.
          </p>

          <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-3">
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

          <div className="mx-auto mt-16 max-w-3xl">
            <h2 className="text-center text-3xl font-semibold sm:text-4xl">what a credit buys</h2>
            <p className="mx-auto mt-3 max-w-md text-center text-[15px] text-muted-foreground">
              credits are a simple usage balance. your dashboard shows what&apos;s left and when it
              resets.
            </p>
            <div className="surface mt-8 divide-y divide-border">
              {COSTS.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 px-6 py-4">
                  <span className="font-medium">{row.label}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{row.credits}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Explore is free every month, forever; Pro and Max can buy extra credit packs.
            </p>
          </div>

          <div className="mt-14 text-center">
            <Link
              href="/faq"
              className="inline-flex items-center gap-1 border-b border-foreground/40 text-sm font-semibold"
            >
              questions? read the faq <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </SitePage>
  )
}
