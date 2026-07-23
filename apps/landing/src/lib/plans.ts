import { Sparkles, Crown, Cuboid } from "lucide-react"

export const PLANS = [
  {
    key: "explore",
    name: "Explore",
    priceUsd: 0,
    priceSub: "/ month",
    badge: "Free forever",
    desc: "Text, voice, and memory on Telegram, free every month. No card needed.",
    icon: Sparkles,
    features: [
      "100 credits every month",
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
      "300 credits / month",
      "Buy extra credit packs anytime",
      "Text, voice, photos & memory",
      "Unlimited app connectors",
      "Web dashboard",
    ],
  },
  {
    key: "max",
    name: "Max",
    priceUsd: 40,
    priceSub: "/ month",
    badge: "Power users",
    desc: "High-volume credits for power users.",
    icon: Cuboid,
    features: [
      "Everything in Pro",
      "750 credits / month",
      "Buy extra credit packs anytime",
      "Unlimited app connectors",
      "Experimental features first",
    ],
  },
]
