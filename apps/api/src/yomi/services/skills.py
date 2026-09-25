"""The skills gallery: ready-made things Yomi does, shared by web and bot.

A ``routine`` skill becomes a schedule (tagged with ``skill_id``) that runs on
the cron tick and reports on Telegram. A ``chat`` skill is something you just
ask for. Either can be tried immediately from the web through the bot deep
link ``/start skill_<id>``, which runs the skill's prompt as a message.

Every prompt only relies on tools Yomi really has; ``works_with`` names the
connectors that make a skill better, it never gates it.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

SkillKind = Literal["routine", "chat"]


class Skill(TypedDict, total=False):
    id: str
    name: str
    emoji: str
    category: str
    kind: SkillKind
    description: str
    prompt: str
    schedule: str
    works_with: list[str]


SKILLS: list[Skill] = [
    {
        "id": "morning-brief",
        "name": "Morning brief",
        "emoji": "☀️",
        "category": "productivity",
        "kind": "routine",
        "schedule": "every day at 8am",
        "description": "Every morning: today's calendar, important unread email, pending "
        "approvals, anything new in your Yomi inbox and yesterday's spending.",
        "prompt": "Give me my morning brief: today's calendar, important unread email, pending "
        "approvals, anything new in my Yomi inbox, and yesterday's spending. Keep it short "
        "and skip sections with nothing in them.",
        "works_with": ["google", "google-calendar"],
    },
    {
        "id": "inbox-followup",
        "name": "Inbox follow-ups",
        "emoji": "📬",
        "category": "productivity",
        "kind": "routine",
        "schedule": "every weekday at 4pm",
        "description": "Finds important emails you haven't answered in 3 days and drafts "
        "replies. Nothing sends until you approve.",
        "prompt": "Find important emails from the last 3 days that I haven't replied to. List "
        "them with one line each and offer a draft reply for the top 3. Do not send anything.",
        "works_with": ["google"],
    },
    {
        "id": "weekly-reset",
        "name": "Weekly reset",
        "emoji": "🧭",
        "category": "productivity",
        "kind": "routine",
        "schedule": "every sunday at 6pm",
        "description": "Sunday evening: next week's calendar, conflicts, and three priorities "
        "to focus on.",
        "prompt": "Review my calendar for the coming week. Flag conflicts and overloaded days, "
        "and suggest three priorities for the week.",
        "works_with": ["google-calendar"],
    },
    {
        "id": "deadline-watch",
        "name": "Deadline watch",
        "emoji": "⏰",
        "category": "study",
        "kind": "routine",
        "schedule": "every day at 7pm",
        "description": "Every evening, anything due in the next 3 days from Classroom and your "
        "calendar, most urgent first.",
        "prompt": "List everything due in the next 3 days from Google Classroom and my calendar, "
        "most urgent first, with how long I have left. If nothing is due, say so in one line.",
        "works_with": ["google-classroom", "google-calendar"],
    },
    {
        "id": "spending-recap",
        "name": "Weekly spending recap",
        "emoji": "💸",
        "category": "money",
        "kind": "routine",
        "schedule": "every sunday at 8pm",
        "description": "What you spent this week from vault payments and emailed receipts, "
        "with the biggest merchants.",
        "prompt": "Summarise what I spent this week from my vault payments and the receipts in "
        "my Yomi inbox: total per currency and the top merchants.",
    },
    {
        "id": "github-digest",
        "name": "GitHub digest",
        "emoji": "🐙",
        "category": "work",
        "kind": "routine",
        "schedule": "every weekday at 9am",
        "description": "Pull requests waiting on your review and issues assigned to you, every "
        "weekday morning.",
        "prompt": "List GitHub pull requests waiting for my review and issues assigned to me, "
        "oldest first, one line each with the repo.",
        "works_with": ["github"],
    },
    {
        "id": "receipt-tracker",
        "name": "Receipt tracker",
        "emoji": "🧾",
        "category": "money",
        "kind": "chat",
        "description": "Forward receipts to your Yomi email and they're logged to your spending "
        "automatically.",
        "prompt": "What's my Yomi email address, and how do I use it to track receipts?",
    },
    {
        "id": "meal-log",
        "name": "Meal log",
        "emoji": "🥗",
        "category": "wellness",
        "kind": "chat",
        "description": "Send a photo of your plate and Yomi estimates calories and macros, and "
        "remembers your goals.",
        "prompt": "I want to log meals by sending you photos. Ask me my daily calorie goal and "
        "remember it, then tell me how to send a meal.",
    },
    {
        "id": "trip-planner",
        "name": "Trip planner",
        "emoji": "✈️",
        "category": "travel",
        "kind": "chat",
        "description": "Tell Yomi where and when; it compares options, builds a day-by-day "
        "plan and saves the bookings to your calendar.",
        "prompt": "Help me plan a trip. Ask me where, when and my budget, then research options "
        "and propose a day-by-day plan.",
        "works_with": ["google-calendar"],
    },
    {
        "id": "find-a-time",
        "name": "Find a time with a friend",
        "emoji": "🤝",
        "category": "people",
        "kind": "chat",
        "description": "Yomi messages a trusted person's Yomi to find a time that works for "
        "both of you.",
        "prompt": "Help me find a time to meet one of my trusted people. Ask me who and roughly "
        "when, check my calendar, then draft a message to their Yomi for my approval.",
        "works_with": ["google-calendar"],
    },
    {
        "id": "deep-research",
        "name": "Deep research",
        "emoji": "🔎",
        "category": "work",
        "kind": "chat",
        "description": "Ask a hard question; Yomi searches the web, reads the sources and "
        "sends a short cited answer.",
        "prompt": "I have a research question. Ask me what it is, then search the web, read the "
        "best sources and give me a short answer with links.",
    },
    {
        "id": "price-check",
        "name": "Price check",
        "emoji": "🛒",
        "category": "shopping",
        "kind": "chat",
        "description": "Send a product and Yomi compares prices across shops before you buy.",
        "prompt": "I want to compare prices for something. Ask me what product, then search "
        "shops and show the best prices with links.",
    },
]

CATEGORIES = [
    "productivity", "money", "work", "study", "travel", "wellness", "people", "shopping",
]

_BY_ID = {skill["id"]: skill for skill in SKILLS}


def get_skill(skill_id: str) -> Skill | None:
    return _BY_ID.get(skill_id)


def public_skill(skill: Skill) -> dict[str, Any]:
    return {
        "id": skill["id"],
        "name": skill["name"],
        "emoji": skill["emoji"],
        "category": skill["category"],
        "kind": skill["kind"],
        "description": skill["description"],
        "schedule": skill.get("schedule"),
        "worksWith": skill.get("works_with", []),
    }
