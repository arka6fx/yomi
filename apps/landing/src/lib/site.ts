import type { Metadata } from "next"

export const SITE_NAME = "Yomi"
export const SITE_URL = "https://getyomi.in"

// Home gets brand + tagline with no suffix; every other page is "<Page> – Yomi".
// Kept here because the home title is also the OG/Twitter/og-image title, and the
// copies in layout.tsx and page.tsx had already drifted apart.
export const SITE_TITLE = "Yomi – AI productivity assistant on Telegram"
export const TITLE_TEMPLATE = "%s – Yomi"

// One description for description/og/twitter, kept under ~160 chars so search results
// don't truncate it. Was two different 220-280 char connector lists that both got cut off.
export const SITE_DESC =
  "The AI assistant that lives in your Telegram. Text, talk, or send a photo — Yomi acts across Gmail, Calendar, Drive, GitHub, Slack, and Notion, and asks first."

const pageTitle = (title: string) => TITLE_TEMPLATE.replace("%s", title)

const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630 }

// A child's openGraph replaces the root layout's entirely rather than merging, so every
// page that wants its own og:url has to restate siteName/locale/image. Without this the
// whole site shared the home page's og:title and og:url, and shared links all looked
// identical no matter which page was posted.
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): Metadata {
  const url = `${SITE_URL}${path}`
  const full = pageTitle(title)

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: SITE_NAME,
      url,
      title: full,
      description,
      images: [{ ...OG_IMAGE, alt: full }],
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description,
      images: [OG_IMAGE.url],
    },
  }
}
