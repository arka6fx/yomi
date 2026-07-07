import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Yomi offers a free 30-day Explore trial with 25 credits. Upgrade to Pro ($14.99/mo, 2,500 credits) or Max ($39.99/mo, 10,000 credits) for more usage, unlimited app connectors, and Telegram bot access.",
  alternates: { canonical: "https://yomi.arka6fx.com/pricing" },
  openGraph: {
    title: "Yomi Pricing: Free, Pro & Max plans",
    description:
      "Start free with 25 credits and unlimited app connectors. Upgrade to Pro or Max for more monthly credits and credit packs.",
    url: "https://yomi.arka6fx.com/pricing",
  },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
