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
    default: "Yomi - Your AI buddy on every screen",
  },
  description: "Yomi sees your screen, hears your voice, and acts so you touch your laptop less.",
  manifest: "/site.webmanifest",
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
