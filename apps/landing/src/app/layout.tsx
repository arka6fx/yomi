import type { Metadata } from "next"
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google"
import { caveat } from "@/lib/fonts"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"
import "./globals.css"

// Body / UI typeface — Inter (optical 14..32, full weight range).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

// Display / heading typeface — Instrument Serif (roman + italic accent).
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["400"],
  style: ["normal", "italic"],
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
})

const META_DESC =
  "Yomi is an AI assistant that sees your screen, hears your voice, and connects to Gmail, Calendar, Drive, GitHub, Notion, Slack, and more, so you can get answers without switching windows."

export const metadata: Metadata = {
  metadataBase: new URL("https://getyomi.in"),
  title: {
    template: "%s | Yomi",
    default: "Yomi: AI assistant for your screen, voice, and apps",
  },
  description: META_DESC,
  keywords: [
    "AI assistant",
    "screen-aware AI",
    "voice AI",
    "AI productivity",
    "desktop AI",
    "Windows AI assistant",
    "Gmail AI",
    "Google Drive AI",
    "AI for work",
    "natural language productivity",
    "Yomi",
  ],
  authors: [{ name: "Arka Garai", url: "https://getyomi.in" }],
  creator: "Arka Garai",
  publisher: "Yomi",
  manifest: "/site.webmanifest",
  // verification: { google: "PASTE_GOOGLE_SEARCH_CONSOLE_CODE_HERE" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://getyomi.in",
    siteName: "Yomi",
    title: "Yomi: AI assistant for your screen, voice, and apps",
    description: META_DESC,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Yomi: AI assistant for your screen, voice, and apps",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Yomi: AI assistant for your screen, voice, and apps",
    description: META_DESC,
    images: ["/opengraph-image"],
    creator: "@yomi_app",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    other: [{ rel: "mask-icon", url: "/favicon.svg", color: "#0a0a0b" }],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        "dark antialiased",
        inter.variable,
        instrumentSerif.variable,
        caveat.variable,
        mono.variable,
      )}
    >
      <body className="bg-background text-foreground min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
