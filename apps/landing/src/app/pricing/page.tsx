import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import PricingCard from "@/components/PricingCard"
import Link from "next/link"

const plans = [
  {
    name: "Free",
    price: "Free",
    features: [
      "10 LLM calls / day",
      "2 STT minutes / day",
      "TTS included",
      "Standard support",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
  },
  {
    name: "Basic",
    price: "$4",
    features: [
      "500 LLM calls / day",
      "30 STT minutes / day",
      "Screenshot analysis",
      "Email support",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
    popular: true,
  },
  {
    name: "Standard",
    price: "$9",
    features: [
      "2,000 LLM calls / day",
      "120 STT minutes / day",
      "Agent pipeline",
      "Screenshot analysis",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
  },
  {
    name: "Genesis",
    price: "$19",
    features: [
      "10,000 LLM calls / day",
      "600 STT minutes / day",
      "Agent pipeline",
      "Priority support",
    ],
    cta: "Join waitlist",
    ctaHref: "/#waitlist",
  },
]

type CheckVal = "✓" | "✗" | string

interface ComparisonRow {
  label: string
  free: CheckVal
  basic: CheckVal
  standard: CheckVal
  genesis: CheckVal
}

const rows: ComparisonRow[] = [
  { label: "LLM calls / day", free: "10", basic: "500", standard: "2,000", genesis: "10,000" },
  { label: "STT minutes / day", free: "2", basic: "30", standard: "120", genesis: "600" },
  { label: "TTS", free: "✓", basic: "✓", standard: "✓", genesis: "✓" },
  { label: "Screenshot analysis", free: "✗", basic: "✓", standard: "✓", genesis: "✓" },
  { label: "Agent pipeline", free: "✗", basic: "✗", standard: "✓", genesis: "✓" },
  { label: "Support", free: "Standard", basic: "Email", standard: "Email", genesis: "Priority" },
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
            Start free. Upgrade when you need more.
            <br />
            Paid via Razorpay — cards, UPI, and international payments.
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
                    Basic
                  </th>
                  <th className="text-center px-4 py-4 text-sm font-display font-semibold text-label">
                    Standard
                  </th>
                  <th className="text-center px-4 py-4 text-sm font-display font-semibold text-label">
                    Genesis
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
                      <Cell val={row.basic} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Cell val={row.standard} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Cell val={row.genesis} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center mt-8 text-caption text-sm">
            All plans use OpenAI. No BYOK needed.{" "}
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
