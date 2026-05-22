import type { Metadata } from "next"
import { Geist, JetBrains_Mono } from "next/font/google"
import { caveat } from "@/lib/fonts"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"
import "./globals.css"

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
  title: "Yomi — Your AI buddy on every screen",
  description:
    "Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("antialiased", geist.variable, caveat.variable, mono.variable)}
    >
      <body className="bg-canvas text-label min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
