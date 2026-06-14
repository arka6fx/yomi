import type { Metadata } from "next"
import { EB_Garamond, Geist, JetBrains_Mono } from "next/font/google"
import { caveat } from "@/lib/fonts"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"
import "./globals.css"

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-accent",
  weight: ["400", "500", "600", "700"],
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  title: {
    template: "%s | Yomi",
    default: "Yomi — AI assistant for your screen, voice, and apps",
  },
  description:
    "Yomi is an AI assistant that sees your screen, hears your voice, and connects to Gmail, Calendar, Drive, GitHub, Notion, Slack, and more — so you can get answers without switching windows.",
  manifest: "/site.webmanifest",
  // To verify domain ownership with Google Search Console:
  // 1. Go to search.google.com/search-console → Add property → URL prefix → yomi.arka6fx.com
  // 2. Choose "HTML tag" verification method and copy the content value
  // 3. Uncomment the line below and paste the value
  // verification: { google: "PASTE_VERIFICATION_CODE_HERE" },
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
      className={cn(
        "dark antialiased",
        geist.variable,
        ebGaramond.variable,
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
