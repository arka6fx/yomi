import type { Metadata } from "next"
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import { SITE_DESC, SITE_NAME, SITE_TITLE, TITLE_TEMPLATE } from "@/lib/site"
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

export const metadata: Metadata = {
  metadataBase: new URL("https://getyomi.in"),
  title: {
    template: TITLE_TEMPLATE,
    default: SITE_TITLE,
  },
  description: SITE_DESC,
  authors: [{ name: "Arka Garai", url: "https://getyomi.in" }],
  creator: "Arka Garai",
  publisher: "Yomi",
  manifest: "/site.webmanifest",
  // verification: { google: "PASTE_GOOGLE_SEARCH_CONSOLE_CODE_HERE" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://getyomi.in",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
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
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("dark antialiased", inter.variable, instrumentSerif.variable, mono.variable)}
    >
      {/* warms the DNS/TLS handshake to the API host before the first fetch — react 19
          hoists link/meta tags rendered anywhere in the tree up into <head>.
          use-credentials matches how auth-client actually calls the API (cross-subdomain
          session cookies), otherwise the browser opens a second connection and this is wasted */}
      <link rel="preconnect" href="https://api.getyomi.in" crossOrigin="use-credentials" />
      <body className="bg-background text-foreground min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
