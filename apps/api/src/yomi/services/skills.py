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
    {
        "id": "needs-reply-sweep",
        "name": "Needs-reply inbox sweep",
        "emoji": "📥",
        "category": "work",
        "kind": "routine",
        "schedule": "every weekday at 6pm",
        "description": "Every weekday evening: the emails still waiting on your reply, and who "
        "has gone quiet on you, with drafts one tap away.",
        "prompt": "Find emails from the last 7 days that are waiting on my reply, and threads "
        "where I replied and the other person hasn't answered in 3+ days. One line each, most "
        "important first, and offer to draft replies. Do not send anything.",
        "works_with": ["google"],
    },
    {
        "id": "meeting-prep",
        "name": "Meeting prep brief",
        "emoji": "🗂️",
        "category": "work",
        "kind": "routine",
        "schedule": "every weekday at 8am",
        "description": "Every weekday morning: who you're meeting today, your last emails with "
        "them, and what to walk in knowing.",
        "prompt": "For each meeting on my calendar today, tell me who it's with, summarise my "
        "recent emails with them, and add one or two things worth knowing from a quick web "
        "search about them or their company. Skip meetings with only me.",
        "works_with": ["google", "google-calendar"],
    },
    {
        "id": "follow-up-chaser",
        "name": "Follow-up chaser",
        "emoji": "🏃",
        "category": "work",
        "kind": "routine",
        "schedule": "every weekday at 10am",
        "description": "Tell Yomi who you're waiting on; every morning it checks what's still "
        "hanging and drafts the nudge.",
        "prompt": "Check the people and replies I told you I'm waiting on (from memory). For "
        "anything still unanswered, list it with how long it's been and draft a short, polite "
        "follow-up for my approval. If I haven't told you anything, ask me who I'm waiting on.",
        "works_with": ["google"],
    },
    {
        "id": "newsletter-digest",
        "name": "Newsletter digest",
        "emoji": "📰",
        "category": "news",
        "kind": "routine",
        "schedule": "every day at 7am",
        "description": "Your newsletters read for you overnight and sent as one tight morning "
        "text: the signal without the inbox.",
        "prompt": "Read the newsletters in my email from the last 24 hours and send one short "
        "digest: the 5 most interesting points with the newsletter name for each.",
        "works_with": ["google"],
    },
    {
        "id": "news-digest",
        "name": "Daily news digest",
        "emoji": "🗞️",
        "category": "news",
        "kind": "routine",
        "schedule": "every day at 8am",
        "description": "A once-a-day digest of the stories that matter to you: your topics, "
        "tight summaries, links, zero doomscrolling.",
        "prompt": "Search today's news on the topics I care about (from memory; ask me once if "
        "you don't know them) and send 5 short summaries with a source link each.",
    },
    {
        "id": "outfit-brief",
        "name": "Weather + outfit brief",
        "emoji": "🌦️",
        "category": "lifestyle",
        "kind": "routine",
        "schedule": "every day at 7:30am",
        "description": "Each morning: the weather where you are and where your day takes you, "
        "then what to wear and whether to bring an umbrella.",
        "prompt": "Check today's weather for my city (from memory; ask once if unknown) and for "
        "any places on my calendar today, then suggest what to wear in two lines.",
        "works_with": ["google-calendar"],
    },
    {
        "id": "birthday-keeper",
        "name": "Birthdays & dates keeper",
        "emoji": "🎂",
        "category": "people",
        "kind": "routine",
        "schedule": "every day at 9am",
        "description": "Tell Yomi the dates that matter once. It remembers them and gives you "
        "a heads-up the day before.",
        "prompt": "Check the birthdays and important dates I've told you about (from memory) "
        "and my calendar. If one is tomorrow or today, remind me and suggest a short message "
        "or gift idea. If none, send nothing.",
        "works_with": ["google-calendar"],
    },
    {
        "id": "daily-check-in",
        "name": "Daily check-in",
        "emoji": "🌙",
        "category": "wellness",
        "kind": "routine",
        "schedule": "every day at 9pm",
        "description": "One question every evening about your day and your habits, a running "
        "journal Yomi keeps for you, and a Sunday look-back.",
        "prompt": "Ask me one short question about how today went and whether I kept my "
        "habits. Remember my answer. On Sundays, also give me a three-line look-back at the "
        "week from what I told you.",
    },
    {
        "id": "linear-digest",
        "name": "Linear morning digest",
        "emoji": "📐",
        "category": "work",
        "kind": "routine",
        "schedule": "every weekday at 9am",
        "description": "Every weekday morning, your assigned Linear issues by priority, with "
        "anything due soon flagged.",
        "prompt": "List my assigned Linear issues by priority, one line each, and flag anything "
        "due in the next 3 days.",
        "works_with": ["linear"],
    },
    {
        "id": "language-drop",
        "name": "Daily language drop",
        "emoji": "🗣️",
        "category": "study",
        "kind": "routine",
        "schedule": "every day at 9am",
        "description": "One useful phrase a day in the language you're learning, with real "
        "usage and a Sunday quiz.",
        "prompt": "Teach me one useful everyday phrase in the language I'm learning (from "
        "memory; ask once if unknown): the phrase, what it means, and one example. On Sundays, "
        "quiz me on the week's phrases instead.",
    },
    {
        "id": "nag-until-done",
        "name": "Nag me until it's done",
        "emoji": "🔔",
        "category": "productivity",
        "kind": "chat",
        "description": "Tell Yomi a task and it checks in on repeat until you say it's done. "
        "The friend who won't let it slide.",
        "prompt": "I have a task I keep putting off. Ask me what it is and how often to nudge "
        "me, then set up a routine that checks in until I tell you it's done, and remove it "
        "when I do.",
    },
    {
        "id": "should-i-send",
        "name": "Should I send this?",
        "emoji": "🤔",
        "category": "people",
        "kind": "chat",
        "description": "Paste the text you're about to send and get an honest read: how it "
        "lands, and a tighter version in your voice. Yomi never sends it for you.",
        "prompt": "I want a second opinion on a message before I send it. Ask me to paste it and "
        "who it's for, then tell me honestly how it will land and offer a tighter version. "
        "Don't send anything.",
    },
    {
        "id": "package-tracker",
        "name": "Package tracker",
        "emoji": "📦",
        "category": "shopping",
        "kind": "chat",
        "description": "Forward an order confirmation to your Yomi email and it keeps track: "
        "shipped, out for delivery, delivered, stuck.",
        "prompt": "I want to track a package. Tell me my Yomi email address to forward the order "
        "confirmation to, then check the tracking and tell me where it is.",
    },
    {
        "id": "price-watch",
        "name": "Price & restock watch",
        "emoji": "🏷️",
        "category": "shopping",
        "kind": "chat",
        "description": "Tell Yomi what you're hunting (sneakers, tickets, a gadget) and your "
        "price. It checks every day and texts you when it moves.",
        "prompt": "I want to watch a price. Ask me the product, a link if I have one, and my "
        "target price, then set up a daily routine that checks it and only messages me when "
        "it drops below my price or comes back in stock.",
    },
]

CATEGORIES = [
    "productivity", "money", "work", "study", "travel", "wellness", "people", "shopping",
    "news", "lifestyle",
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
