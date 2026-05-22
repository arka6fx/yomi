import type { Metadata } from "next"
import { Syne, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  weight: ["400", "500", "600", "700", "800"],
})

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600"],
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
  openGraph: {
    title: "Yomi — Your AI buddy on every screen",
    description:
      "Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Yomi — Your AI buddy on every screen",
    description:
      "Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${jakarta.variable} ${mono.variable}`}
    >
      <body className="bg-canvas text-label font-sans antialiased">{children}</body>
    </html>
  )
}
