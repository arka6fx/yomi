import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/landing-page"

export const metadata: Metadata = {
  title: { absolute: "Yomi — AI Productivity Assistant" },
  description:
    "Yomi is an AI productivity assistant that connects with Google Drive, Gmail, Google Calendar, GitHub, Slack, Notion, Linear, and other services to help users search, organize, and automate work.",
}

export default function Home() {
  return <LandingPage />
}
