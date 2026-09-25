import { TELEGRAM_BOT_URL } from "@/lib/site"

// Public copy of the skills gallery for the marketing pages, which are prerendered and
// can't call the signed-in /api/skills. The source of truth is SKILLS in
// apps/api/src/yomi/services/skills.py; keep ids, names and schedules in step with it.
export type CatalogSkill = {
  id: string
  name: string
  emoji: string
  category: string
  kind: "routine" | "chat"
  schedule?: string
  description: string
  worksWith?: string[]
  // a short "try" line for the landing page's prompt pills
  ask: string
}

export const SKILL_CATALOG: CatalogSkill[] = [
  {
    id: "morning-brief",
    name: "Morning brief",
    emoji: "☀️",
    category: "productivity",
    kind: "routine",
    schedule: "every day at 8am",
    description:
      "Every morning: today's calendar, important unread email, pending approvals, anything new in your Yomi inbox and yesterday's spending.",
    worksWith: ["google", "google-calendar"],
    ask: "brief me every morning",
  },
  {
    id: "inbox-followup",
    name: "Inbox follow-ups",
    emoji: "📬",
    category: "productivity",
    kind: "routine",
    schedule: "every weekday at 4pm",
    description:
      "Finds important emails you haven't answered in 3 days and drafts replies. Nothing sends until you approve.",
    worksWith: ["google"],
    ask: "stop ghosting my inbox",
  },
  {
    id: "weekly-reset",
    name: "Weekly reset",
    emoji: "🧭",
    category: "productivity",
    kind: "routine",
    schedule: "every sunday at 6pm",
    description:
      "Sunday evening: next week's calendar, conflicts, and three priorities to focus on.",
    worksWith: ["google-calendar"],
    ask: "plan my week",
  },
  {
    id: "deadline-watch",
    name: "Deadline watch",
    emoji: "⏰",
    category: "study",
    kind: "routine",
    schedule: "every day at 7pm",
    description:
      "Every evening, anything due in the next 3 days from Classroom and your calendar, most urgent first.",
    worksWith: ["google-classroom", "google-calendar"],
    ask: "never miss a deadline",
  },
  {
    id: "spending-recap",
    name: "Weekly spending recap",
    emoji: "💸",
    category: "money",
    kind: "routine",
    schedule: "every sunday at 8pm",
    description:
      "What you spent this week from vault payments and emailed receipts, with the biggest merchants.",
    ask: "see where my money went",
  },
  {
    id: "github-digest",
    name: "GitHub digest",
    emoji: "🐙",
    category: "work",
    kind: "routine",
    schedule: "every weekday at 9am",
    description:
      "Pull requests waiting on your review and issues assigned to you, every weekday morning.",
    worksWith: ["github"],
    ask: "catch up on my PRs",
  },
  {
    id: "receipt-tracker",
    name: "Receipt tracker",
    emoji: "🧾",
    category: "money",
    kind: "chat",
    description:
      "Forward receipts to your Yomi email and they're logged to your spending automatically.",
    ask: "log my receipts",
  },
  {
    id: "meal-log",
    name: "Meal log",
    emoji: "🥗",
    category: "wellness",
    kind: "chat",
    description:
      "Send a photo of your plate and Yomi estimates calories and macros, and remembers your goals.",
    ask: "log what i ate",
  },
  {
    id: "trip-planner",
    name: "Trip planner",
    emoji: "✈️",
    category: "travel",
    kind: "chat",
    description:
      "Tell Yomi where and when; it compares options, builds a day-by-day plan and saves the bookings to your calendar.",
    worksWith: ["google-calendar"],
    ask: "plan my next trip",
  },
  {
    id: "find-a-time",
    name: "Find a time with a friend",
    emoji: "🤝",
    category: "people",
    kind: "chat",
    description: "Yomi messages a trusted person's Yomi to find a time that works for both of you.",
    worksWith: ["google-calendar"],
    ask: "find time with a friend",
  },
  {
    id: "deep-research",
    name: "Deep research",
    emoji: "🔎",
    category: "work",
    kind: "chat",
    description:
      "Ask a hard question; Yomi searches the web, reads the sources and sends a short cited answer.",
    ask: "research this for me",
  },
  {
    id: "price-check",
    name: "Price check",
    emoji: "🛒",
    category: "shopping",
    kind: "chat",
    description: "Send a product and Yomi compares prices across shops before you buy.",
    ask: "find me the best price",
  },
]

export const SKILL_CATEGORIES = [
  "productivity",
  "money",
  "work",
  "study",
  "travel",
  "wellness",
  "people",
  "shopping",
]

export const APP_NAMES: Record<string, string> = {
  google: "Gmail",
  "google-calendar": "Calendar",
  "google-classroom": "Classroom",
  github: "GitHub",
}

export function skillTryLink(id: string) {
  return `${TELEGRAM_BOT_URL}?start=skill_${id}`
}

export function getCatalogSkill(id: string) {
  return SKILL_CATALOG.find((skill) => skill.id === id)
}
