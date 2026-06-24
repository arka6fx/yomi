import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/landing-page"

// static prerender — LandingPage forwards ?error= to /signin client-side
export const dynamic = "force-static"

const TITLE = "Yomi — AI Productivity Assistant for Windows"
const DESC =
  "Yomi sees your screen, hears your voice, and connects to Gmail, Google Calendar, Google Drive, GitHub, Slack, Notion, Linear, and Discord. Ask questions about your work in natural language — no copy-pasting, no window switching."

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: "https://yomi.arka6fx.com" },
  openGraph: {
    title: TITLE,
    description: DESC,
    url: "https://yomi.arka6fx.com",
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
      "@id": "https://yomi.arka6fx.com/#website",
      url: "https://yomi.arka6fx.com",
      name: "Yomi",
      description: DESC,
      publisher: { "@id": "https://yomi.arka6fx.com/#organization" },
    },
    {
      "@type": "Organization",
      "@id": "https://yomi.arka6fx.com/#organization",
      name: "Yomi",
      url: "https://yomi.arka6fx.com",
      logo: {
        "@type": "ImageObject",
        url: "https://yomi.arka6fx.com/android-chrome-512x512.png",
        width: 512,
        height: 512,
      },
      contactPoint: {
        "@type": "ContactPoint",
        email: "owner@example.com",
        contactType: "customer support",
      },
      sameAs: ["https://github.com/arka6fx/yomi-releases"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://yomi.arka6fx.com/#app",
      name: "Yomi",
      description: DESC,
      url: "https://yomi.arka6fx.com",
      downloadUrl: "https://yomi.arka6fx.com/download",
      applicationCategory: "ProductivityApplication",
      operatingSystem: "Windows 10, Windows 11",
      softwareVersion: "1.0",
      offers: [
        {
          "@type": "Offer",
          name: "Explore",
          price: "0",
          priceCurrency: "USD",
          description: "Free tier — 100 AI chats/month and app connectors",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: "14.99",
          priceCurrency: "USD",
          billingDuration: "P1M",
          description: "2,000 AI chats/month and app connectors",
        },
        {
          "@type": "Offer",
          name: "Max",
          price: "39.99",
          priceCurrency: "USD",
          billingDuration: "P1M",
          description: "8,000 AI chats/month, app connectors, early access",
        },
      ],
      author: {
        "@type": "Person",
        name: "Arka Garai",
      },
      publisher: { "@id": "https://yomi.arka6fx.com/#organization" },
      featureList: [
        "Screen-aware AI responses",
        "Voice push-to-talk",
        "Gmail integration",
        "Google Calendar integration",
        "Google Drive integration",
        "GitHub integration",
        "Slack integration",
        "Notion integration",
        "Linear integration",
        "Discord integration",
        "Telegram bot",
        "System tray app",
        "Local memory notepad",
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
            text: "Yomi is an AI productivity assistant that runs in your Windows system tray. It sees your screen, hears your voice, and connects to Gmail, Google Calendar, Google Drive, GitHub, Slack, Notion, Linear, and Discord so you can ask questions about your work in natural language.",
          },
        },
        {
          "@type": "Question",
          name: "Is Yomi free?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Yomi has a free Explore plan with 100 AI chats per month and app connectors. Paid plans start at $14.99/month for higher usage limits.",
          },
        },
        {
          "@type": "Question",
          name: "What operating systems does Yomi support?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yomi currently supports Windows 10 and Windows 11. macOS support is planned for a future release.",
          },
        },
        {
          "@type": "Question",
          name: "How does Yomi access my Google data?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yomi only accesses your Gmail, Google Calendar, or Google Drive data after you explicitly grant permission through Google's OAuth consent flow. Data is accessed on-demand when you ask a question and is never stored after the request completes.",
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
