import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/landing-page"

// static prerender — LandingPage forwards ?error= to /signin client-side
export const dynamic = "force-static"

const TITLE = "Yomi: AI Productivity Assistant on Telegram"
const DESC =
  "Yomi is an AI assistant on Telegram that acts across Gmail, Calendar, Drive, Classroom, Tasks, Meet, GitHub, Slack, Notion, and Linear. Message it with text, voice, or a photo — ask in plain language, approve every change."

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: "https://getyomi.in" },
  openGraph: {
    title: TITLE,
    description: DESC,
    url: "https://getyomi.in",
    type: "website",
  },
  twitter: {
    title: TITLE,
    description: DESC,
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://getyomi.in/#website",
      url: "https://getyomi.in",
      name: "Yomi",
      description: DESC,
      publisher: { "@id": "https://getyomi.in/#organization" },
    },
    {
      "@type": "Organization",
      "@id": "https://getyomi.in/#organization",
      name: "Yomi",
      url: "https://getyomi.in",
      logo: {
        "@type": "ImageObject",
        url: "https://getyomi.in/android-chrome-512x512.png",
        width: 512,
        height: 512,
      },
      contactPoint: {
        "@type": "ContactPoint",
        email: "contact.arkagarai@gmail.com",
        contactType: "customer support",
      },
      sameAs: ["https://github.com/arka6fx/yomi-feedback"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://getyomi.in/#app",
      name: "Yomi",
      description: DESC,
      url: "https://getyomi.in",

      applicationCategory: "ProductivityApplication",
      operatingSystem: "Web-based, Telegram",
      softwareVersion: "1.0",
      offers: [
        {
          "@type": "Offer",
          name: "Explore",
          price: "0",
          priceCurrency: "USD",
          description: "Free every month, forever, with 100 monthly credits and unlimited app connectors",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: "5",
          priceCurrency: "USD",
          billingDuration: "P1M",
          description: "300 monthly credits, unlimited app connectors, Telegram bot",
        },
        {
          "@type": "Offer",
          name: "Max",
          price: "39.99",
          priceCurrency: "USD",
          billingDuration: "P1M",
          description: "750 monthly credits, unlimited app connectors, early access",
        },
      ],
      author: {
        "@type": "Person",
        name: "Arka Garai",
      },
      publisher: { "@id": "https://getyomi.in/#organization" },
      featureList: [
        "Telegram text, voice, and photo messages",
        "Durable memory",
        "Gmail integration",
        "Google Calendar integration",
        "Google Drive integration",
        "Google Classroom integration",
        "Google Tasks integration",
        "Google Meet integration",
        "GitHub integration",
        "Slack integration",
        "Notion integration",
        "Linear integration",
        "Web dashboard",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is Yomi?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yomi is an AI productivity assistant you talk to on Telegram with text, voice notes, or photos. It connects to Gmail, Google Calendar, Google Drive, Google Classroom, GitHub, Slack, Notion, and Linear so you can ask questions about your work in natural language and have Yomi act across your apps.",
          },
        },
        {
          "@type": "Question",
          name: "Is Yomi free?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Yomi's Explore plan is free every month, forever, with 100 credits and unlimited app connectors. Paid plans start at $5/month (Pro: 300 credits/mo). Credits are a simple usage balance; the dashboard shows remaining credits, monthly usage, and reset date.",
          },
        },
        {
          "@type": "Question",
          name: "What devices does Yomi work on?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yomi works anywhere Telegram does — phone, tablet, or computer — with nothing to install. You manage your account, connectors, schedules, and billing from the Yomi web dashboard in any browser.",
          },
        },
        {
          "@type": "Question",
          name: "How does Yomi access my Google data?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yomi accesses Gmail, Google Calendar, Google Drive, Google Classroom, Google Tasks, or Google Meet only after you explicitly grant permission through Google's OAuth consent flow, and only to answer the request you just made. Every action that changes something — sending an email, creating an event, saving a file — is shown to you for approval first. Data is never sold, transferred, used for advertising, or used to train AI models, and you can disconnect at any time.",
          },
        },
        {
          "@type": "Question",
          name: "Which apps does Yomi connect to?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yomi connects to Gmail, Google Calendar, Google Drive, Google Classroom, Google Tasks, Google Meet, GitHub, Slack, Notion, and Linear. Connectors are unlimited on every plan, including the free Explore trial.",
          },
        },
        {
          "@type": "Question",
          name: "Can I use Yomi from Telegram?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes — Telegram is how you use Yomi. Link your Telegram account from the Yomi dashboard and message the bot to run connector tasks — reading email, checking your calendar, creating documents — right from your phone.",
          },
        },
      ],
    },
  ],
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPage />
    </>
  )
}
