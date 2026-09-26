// Every docs page, in sidebar order. The sidebar, the "on this page" outline, search and
// the static params for /docs/[slug] all read this list; each page's content lives in
// ./content.tsx under the same slug, and its section ids must match `sections`.
export type DocsGroup = "Getting started" | "What yomi can do" | "Plans & account"

export type DocsIcon =
  | "hand"
  | "rocket"
  | "plug"
  | "message"
  | "globe"
  | "shield"
  | "repeat"
  | "search"
  | "brain"
  | "mail"
  | "users"
  | "sparkles"
  | "card"
  | "lock"

export interface DocsPage {
  slug: string // "" is /docs itself
  title: string
  group: DocsGroup
  icon: DocsIcon
  summary: string
  sections: { id: string; title: string }[]
}

export const DOCS_GROUPS: DocsGroup[] = ["Getting started", "What yomi can do", "Plans & account"]

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: "",
    title: "meet yomi",
    group: "Getting started",
    icon: "hand",
    summary: "basically, yomi is your own personal AI that lives in your telegram",
    sections: [
      { id: "more-specifically", title: "more specifically.." },
      { id: "the-best-part", title: "but the best part is..." },
      { id: "start-here", title: "start here" },
      { id: "go-deeper", title: "go deeper" },
    ],
  },
  {
    slug: "getting-started",
    title: "getting started",
    group: "Getting started",
    icon: "rocket",
    summary: "sign up, open yomi on telegram, and send your first message",
    sections: [
      { id: "sign-up", title: "sign up" },
      { id: "open-telegram", title: "open yomi on telegram" },
      { id: "first-messages", title: "your first messages" },
      { id: "commands", title: "handy commands" },
    ],
  },
  {
    slug: "connecting-apps",
    title: "connecting apps",
    group: "Getting started",
    icon: "plug",
    summary: "link gmail, calendar, drive, github, notion and more",
    sections: [
      { id: "how-to-connect", title: "how to connect" },
      { id: "what-you-can-connect", title: "what you can connect" },
      { id: "disconnecting", title: "disconnecting" },
    ],
  },
  {
    slug: "talking-to-yomi",
    title: "talking to yomi",
    group: "What yomi can do",
    icon: "message",
    summary: "text, voice notes and photos, in plain language",
    sections: [
      { id: "text", title: "just text it" },
      { id: "voice", title: "voice notes" },
      { id: "photos", title: "photos and screenshots" },
      { id: "fresh-start", title: "starting fresh" },
    ],
  },
  {
    slug: "approvals",
    title: "approvals & vault",
    group: "What yomi can do",
    icon: "shield",
    summary: "nothing is sent, booked, paid or deleted without your ok",
    sections: [
      { id: "how-approvals-work", title: "how approvals work" },
      { id: "vault", title: "the vault" },
    ],
  },
  {
    slug: "browser",
    title: "yomi's browser",
    group: "What yomi can do",
    icon: "globe",
    summary: "yomi reads the web and can drive its own computer",
    sections: [
      { id: "reading-the-web", title: "reading the web" },
      { id: "the-computer", title: "the computer" },
    ],
  },
  {
    slug: "routines",
    title: "skills & routines",
    group: "What yomi can do",
    icon: "repeat",
    summary: "briefs, check-ins and digests that run on a schedule",
    sections: [
      { id: "routines", title: "routines" },
      { id: "skills", title: "skills" },
      { id: "limits", title: "how many can run" },
    ],
  },
  {
    slug: "research",
    title: "research",
    group: "What yomi can do",
    icon: "search",
    summary: "real answers with sources, not vibes",
    sections: [
      { id: "asking", title: "asking a question" },
      { id: "your-documents", title: "your own documents" },
    ],
  },
  {
    slug: "memory",
    title: "memory",
    group: "What yomi can do",
    icon: "brain",
    summary: "yomi remembers what matters, and you stay in control of it",
    sections: [
      { id: "what-it-remembers", title: "what it remembers" },
      { id: "seeing-and-editing", title: "seeing and editing it" },
    ],
  },
  {
    slug: "email",
    title: "your yomi email",
    group: "What yomi can do",
    icon: "mail",
    summary: "an address of your own for receipts, sign-ups and bookings",
    sections: [
      { id: "your-address", title: "your address" },
      { id: "what-to-send", title: "what to send it" },
    ],
  },
  {
    slug: "trusted-people",
    title: "trusted people",
    group: "What yomi can do",
    icon: "users",
    summary: "let your yomi talk to a friend's yomi",
    sections: [
      { id: "how-it-works", title: "how it works" },
      { id: "staying-in-control", title: "staying in control" },
    ],
  },
  {
    slug: "characters",
    title: "characters",
    group: "What yomi can do",
    icon: "sparkles",
    summary: "change who answers, never what yomi can do",
    sections: [
      { id: "picking-one", title: "picking a character" },
      { id: "switching-back", title: "switching back" },
    ],
  },
  {
    slug: "plans",
    title: "plans",
    group: "Plans & account",
    icon: "card",
    summary: "free forever, or pro for the smarter engine",
    sections: [
      { id: "free-and-pro", title: "free and pro" },
      { id: "referrals", title: "get pro free" },
    ],
  },
  {
    slug: "privacy",
    title: "privacy & your data",
    group: "Plans & account",
    icon: "lock",
    summary: "what yomi keeps, what it doesn't, and how to delete it",
    sections: [
      { id: "what-we-keep", title: "what yomi keeps" },
      { id: "your-controls", title: "your controls" },
    ],
  },
]

export function docsHref(page: Pick<DocsPage, "slug">): string {
  return page.slug ? `/docs/${page.slug}` : "/docs"
}

export function getDocsPage(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find((p) => p.slug === slug)
}

export function matchesQuery(page: DocsPage, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [page.title, page.summary, ...page.sections.map((s) => s.title)].some((field) =>
    field.toLowerCase().includes(q),
  )
}

// Previous / next page in sidebar order, for the footer of each page.
export function neighbours(slug: string): { prev?: DocsPage; next?: DocsPage } {
  const i = DOCS_PAGES.findIndex((p) => p.slug === slug)
  return { prev: DOCS_PAGES[i - 1], next: DOCS_PAGES[i + 1] }
}
