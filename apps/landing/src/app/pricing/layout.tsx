import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Yomi offers a free Explore plan with 100 AI chats/month. Upgrade to Pro ($14.99/mo) or Max ($39.99/mo) for higher limits, all 8 app connectors, and Telegram & Discord bot access.",
  alternates: { canonical: "https://yomi.arka6fx.com/pricing" },
  openGraph: {
    title: "Yomi Pricing — Free, Pro & Max plans",
    description:
      "Start free with 100 AI chats and 2 connectors. Upgrade to Pro or Max for unlimited connectors and higher usage limits.",
    url: "https://yomi.arka6fx.com/pricing",
  },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
