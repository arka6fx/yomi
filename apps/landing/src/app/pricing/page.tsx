import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import PricingCard from "@/components/PricingCard"
import Link from "next/link"

const plans = [
  {
    name: "Free",
    price: "Free",
    features: [
      "50 fast queries / day",
      "1 agent run / month",
      "Local STT + TTS",
      "Bring your own key",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
  },
  {
    name: "Pro",
    price: "$20",
    features: [
      "Unlimited fast queries",
      "100 agent runs / month",
      "Cloud STT + TTS",
      "MCP connectors",
      "Cloud sync",
      "2 months free annually",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
    popular: true,
  },
  {
    name: "Max",
    price: "$50",
    features: [
      "Unlimited fast queries",
      "500 agent runs / month",
      "Cloud STT + TTS",
      "Priority latency",
      "Cloud subagents",
      "2 months free annually",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
  },
  {
    name: "Team",
    price: "$30",
    period: "/user/mo",
    features: [
      "Everything in Pro",
      "SSO + admin console",
      "Shared MCP connectors",
      "500 agent runs / user / mo",
      "2 months free annually",
    ],
    cta: "Contact us",
    ctaHref: "/#waitlist",
  },
]

type CheckVal = "✓" | "✗" | string

interface ComparisonRow {
  label: string
  free: CheckVal
  pro: CheckVal
  max: CheckVal
  team: CheckVal
}

const rows: ComparisonRow[] = [
  { label: "Fast queries", free: "50 / day", pro: "Unlimited", max: "Unlimited", team: "Unlimited" },
  { label: "Agent runs", free: "1 / mo", pro: "100 / mo", max: "500 / mo", team: "500 / user / mo" },
  { label: "STT", free: "Local", pro: "Cloud", max: "Cloud", team: "Cloud" },
  { label: "TTS", free: "Local", pro: "Cloud", max: "Cloud", team: "Cloud" },
  { label: "MCP connectors", free: "✗", pro: "✓", max: "✓", team: "✓" },
  { label: "Cloud sync", free: "✗", pro: "✓", max: "✓", team: "✓" },
  { label: "Bring your own key", free: "✓", pro: "✓", max: "✓", team: "✓" },
  { label: "Priority latency", free: "✗", pro: "✗", max: "✓", team: "✗" },
  { label: "Cloud subagents", free: "✗", pro: "✗", max: "✓", team: "✗" },
  { label: "SSO + admin console", free: "✗", pro: "✗", max: "✗", team: "✓" },
  { label: "Shared connectors", free: "✗", pro: "✗", max: "✗", team: "✓" },
  { label: "Annual discount", free: "—", pro: "2 months free", max: "2 months free", team: "2 months free" },
]

function Cell({ val }: { val: CheckVal }) {
  if (val === "✓") return <span className="text-accent text-base">✓</span>
  if (val === "✗") return <span className="text-caption text-base">✗</span>
  if (val === "—") return <span className="text-caption">—</span>
  return <span className="text-sm text-label/80">{val}</span>
}

export default function PricingPage() {
  return (
    <>
      <Nav />
      <main className="pt-16">
        {/* Header */}
        <section
          className="py-24 text-center"
          style={{
            background:
              "radial-gradient(ellipse 800px 500px at 50% 0%, rgba(45,212,191,0.06) 0%, transparent 70%)",
          }}
        >
          <p className="font-mono text-xs text-caption uppercase tracking-widest mb-3">
            Pricing
          </p>
          <h1 className="font-display text-5xl sm:text-6xl font-extrabold mb-4">
            Simple pricing.
            <br />
            <span className="text-accent">Powerful AI.</span>
          </h1>
          <p className="text-caption max-w-md mx-auto px-6">
            Start free. Upgrade when you need more. Annual plans save 2 months.
          </p>
        </section>

        {/* Plan cards */}
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map((plan) => (
              <PricingCard key={plan.name} {...plan} />
            ))}
          </div>
        </section>

        {/* Comparison table */}
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <h2 className="font-display text-2xl font-bold mb-8 text-center">Full comparison</h2>

          <div className="rounded-2xl border border-edge overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge bg-panel-2">
                  <th className="text-left px-6 py-4 text-sm font-medium text-caption w-1/3">
                    Feature
                  </th>
                  <th className="text-center px-4 py-4 text-sm font-display font-semibold text-label">
                    Free
                  </th>
                  <th className="text-center px-4 py-4 text-sm font-display font-semibold text-accent">
                    Pro
                  </th>
                  <th className="text-center px-4 py-4 text-sm font-display font-semibold text-label">
                    Max
                  </th>
                  <th className="text-center px-4 py-4 text-sm font-display font-semibold text-label">
                    Team
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.label}
                    className={`border-b border-edge/40 ${
                      i % 2 === 0 ? "bg-panel" : "bg-panel/50"
                    } last:border-0`}
                  >
                    <td className="px-6 py-4 text-sm text-caption">{row.label}</td>
                    <td className="px-4 py-4 text-center">
                      <Cell val={row.free} />
                    </td>
                    <td className="px-4 py-4 text-center bg-accent/5">
                      <Cell val={row.pro} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Cell val={row.max} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Cell val={row.team} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center mt-8 text-caption text-sm">
            All plans include BYOK support. Prices are in USD.{" "}
            <Link href="/#waitlist" className="text-accent hover:text-accent/80 transition-colors">
              Join the waitlist →
            </Link>
          </p>
        </section>
      </main>
      <Footer />
    </>
  )
}
