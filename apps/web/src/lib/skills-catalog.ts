import { TELEGRAM_BOT_URL } from "./site"

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
  {
    id: "needs-reply-sweep",
    name: "Needs-reply inbox sweep",
    emoji: "📥",
    category: "work",
    kind: "routine",
    schedule: "every weekday at 6pm",
    description:
      "Every weekday evening: the emails still waiting on your reply, and who has gone quiet on you, with drafts one tap away.",
    worksWith: ["google"],
    ask: "who's waiting on my reply?",
  },
  {
    id: "meeting-prep",
    name: "Meeting prep brief",
    emoji: "🗂️",
    category: "work",
    kind: "routine",
    schedule: "every weekday at 8am",
    description:
      "Every weekday morning: who you're meeting today, your last emails with them, and what to walk in knowing.",
    worksWith: ["google", "google-calendar"],
    ask: "prep me for today's meetings",
  },
  {
    id: "follow-up-chaser",
    name: "Follow-up chaser",
    emoji: "🏃",
    category: "work",
    kind: "routine",
    schedule: "every weekday at 10am",
    description:
      "Tell Yomi who you're waiting on; every morning it checks what's still hanging and drafts the nudge.",
    worksWith: ["google"],
    ask: "chase my follow-ups",
  },
  {
    id: "newsletter-digest",
    name: "Newsletter digest",
    emoji: "📰",
    category: "news",
    kind: "routine",
    schedule: "every day at 7am",
    description:
      "Your newsletters read for you overnight and sent as one tight morning text: the signal without the inbox.",
    worksWith: ["google"],
    ask: "read my newsletters for me",
  },
  {
    id: "news-digest",
    name: "Daily news digest",
    emoji: "🗞️",
    category: "news",
    kind: "routine",
    schedule: "every day at 8am",
    description:
      "A once-a-day digest of the stories that matter to you: your topics, tight summaries, links, zero doomscrolling.",
    ask: "send me the news that matters",
  },
  {
    id: "outfit-brief",
    name: "Weather + outfit brief",
    emoji: "🌦️",
    category: "lifestyle",
    kind: "routine",
    schedule: "every day at 7:30am",
    description:
      "Each morning: the weather where you are and where your day takes you, then what to wear and whether to bring an umbrella.",
    worksWith: ["google-calendar"],
    ask: "what should i wear today?",
  },
  {
    id: "birthday-keeper",
    name: "Birthdays & dates keeper",
    emoji: "🎂",
    category: "people",
    kind: "routine",
    schedule: "every day at 9am",
    description:
      "Tell Yomi the dates that matter once. It remembers them and gives you a heads-up the day before.",
    worksWith: ["google-calendar"],
    ask: "never forget a birthday",
  },
  {
    id: "daily-check-in",
    name: "Daily check-in",
    emoji: "🌙",
    category: "wellness",
    kind: "routine",
    schedule: "every day at 9pm",
    description:
      "One question every evening about your day and your habits, a running journal Yomi keeps for you, and a Sunday look-back.",
    ask: "check in on me every night",
  },
  {
    id: "linear-digest",
    name: "Linear morning digest",
    emoji: "📐",
    category: "work",
    kind: "routine",
    schedule: "every weekday at 9am",
    description:
      "Every weekday morning, your assigned Linear issues by priority, with anything due soon flagged.",
    worksWith: ["linear"],
    ask: "what's on my linear today?",
  },
  {
    id: "language-drop",
    name: "Daily language drop",
    emoji: "🗣️",
    category: "study",
    kind: "routine",
    schedule: "every day at 9am",
    description:
      "One useful phrase a day in the language you're learning, with real usage and a Sunday quiz.",
    ask: "teach me a phrase a day",
  },
  {
    id: "nag-until-done",
    name: "Nag me until it's done",
    emoji: "🔔",
    category: "productivity",
    kind: "chat",
    description:
      "Tell Yomi a task and it checks in on repeat until you say it's done. The friend who won't let it slide.",
    ask: "nag me until it's done",
  },
  {
    id: "should-i-send",
    name: "Should I send this?",
    emoji: "🤔",
    category: "people",
    kind: "chat",
    description:
      "Paste the text you're about to send and get an honest read: how it lands, and a tighter version in your voice. Yomi never sends it for you.",
    ask: "should i send this?",
  },
  {
    id: "package-tracker",
    name: "Package tracker",
    emoji: "📦",
    category: "shopping",
    kind: "chat",
    description:
      "Forward an order confirmation to your Yomi email and it keeps track: shipped, out for delivery, delivered, stuck.",
    ask: "where's my package?",
  },
  {
    id: "price-watch",
    name: "Price & restock watch",
    emoji: "🏷️",
    category: "shopping",
    kind: "chat",
    description:
      "Tell Yomi what you're hunting (sneakers, tickets, a gadget) and your price. It checks every day and texts you when it moves.",
    ask: "tell me when the price drops",
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
  "news",
  "lifestyle",
]

export const APP_NAMES: Record<string, string> = {
  google: "Gmail",
  "google-calendar": "Calendar",
  "google-classroom": "Classroom",
  github: "GitHub",
  linear: "Linear",
}

export function skillTryLink(id: string) {
  return `${TELEGRAM_BOT_URL}?start=skill_${id}`
}

export function getCatalogSkill(id: string) {
  return SKILL_CATALOG.find((skill) => skill.id === id)
}

// "every weekday at 4pm" -> "weekdays · 4pm", "every sunday at 6pm" -> "sunday · 6pm",
// "every day at 8am" -> "daily · 8am". Anything else is returned unchanged.
export function shortSchedule(schedule: string): string {
  const match = schedule.trim().match(/^every\s+(\w+)\s+at\s+(.+)$/i)
  const [, when, time] = match ?? []
  if (!when || !time) return schedule
  const day = when.toLowerCase()
  const label = day === "day" ? "daily" : day === "weekday" ? "weekdays" : day
  return `${label} · ${time}`
}
