import { Sparkles, Crown } from "lucide-react"

// Free and Pro only. There are no credits: chatting is unlimited on both plans.
// Keep in step with apps/api/src/yomi/shared/plans.py.
export const FREE_ROUTINES = 3

export const PLANS = [
  {
    key: "explore",
    name: "Free",
    priceUsd: 0,
    priceSub: "/ month",
    badge: "Free forever",
    desc: "Yomi on Telegram, free for good. No card, no clock, no message cap.",
    icon: Sparkles,
    features: [
      "Unlimited chatting",
      "Every feature: apps, memory, browsing, research, characters",
      "Connect Gmail, Calendar, GitHub & more",
      `${FREE_ROUTINES} routines running in the background`,
      "Remembers everything",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    priceUsd: 5,
    priceSub: "/ month",
    badge: "Recommended",
    desc: "Everything in Free, on the smarter engine, with as many routines as you want.",
    icon: Crown,
    features: [
      "Everything in Free",
      "The smarter engine: thinks longer on hard tasks",
      "Unlimited routines, briefings & reminders",
      "Priority support",
    ],
  },
]
