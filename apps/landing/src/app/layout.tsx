import type { Metadata } from "next"
import { Inter, Geist, JetBrains_Mono } from "next/font/google"
import { caveat } from "@/lib/fonts"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
})

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  title: {
    template: "%s | Yomi",
    default: "Yomi — Your AI buddy on every screen",
  },
  description:
    "Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.",
  icons: { icon: "/favicon.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("dark antialiased", inter.variable, geist.variable, caveat.variable, mono.variable)}
    >
      <body className="bg-background text-foreground min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
