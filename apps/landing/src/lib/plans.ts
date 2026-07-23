import { Sparkles, Crown, Cuboid } from "lucide-react"

export const PLANS = [
  {
    key: "explore",
    name: "Explore",
    priceUsd: 0,
    priceSub: "/ month",
    badge: "30-day trial",
    desc: "Try Yomi on Telegram with text, voice, and memory for 30 days. No card needed.",
    icon: Sparkles,
    features: [
      "100 credits (30-day trial)",
      "Text, voice & photo on Telegram",
      "Durable memory",
      "Unlimited app connectors",
      "Web dashboard",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    priceUsd: 5,
    priceSub: "/ month",
    badge: "Most Popular",
    desc: "Text, voice, photos, and memory for everyday work.",
    icon: Crown,
    features: [
      "85 credits / month",
      "Buy extra credit packs anytime",
      "Text, voice, photos & memory",
      "Unlimited app connectors",
      "Web dashboard",
    ],
  },
  {
    key: "max",
    name: "Max",
    priceUsd: 39.99,
    priceSub: "/ month",
    badge: "Power users",
    desc: "High-volume credits for power users.",
    icon: Cuboid,
    features: [
      "Everything in Pro",
      "10,000 credits / month",
      "Buy extra credit packs anytime",
      "Unlimited app connectors",
      "Experimental features first",
    ],
  },
]
