import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Features",
  description:
    "Yomi sees your screen, transcribes your voice in under 2 seconds, and connects to Gmail, Google Calendar, Google Drive, Google Classroom, GitHub, Slack, Notion, and Linear, all from your Windows system tray.",
  alternates: { canonical: "https://yomi.arka6fx.com/features" },
  openGraph: {
    title: "Yomi Features: Screen AI, Voice, and App Connectors",
    description:
      "Screen-aware AI responses, push-to-talk voice, and integrations with 8 productivity tools. All from a lightweight Windows tray app.",
    url: "https://yomi.arka6fx.com/features",
  },
}

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
