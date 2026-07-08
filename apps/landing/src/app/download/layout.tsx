import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Download",
  description:
    "Download the Yomi desktop app for Windows. Installs in seconds and runs quietly in your system tray, responding to Ctrl+Space for voice or Ctrl+Enter to type.",
  alternates: { canonical: "https://getyomi.in/download" },
  openGraph: {
    title: "Download Yomi for Windows",
    description:
      "Get the Yomi AI assistant for Windows. Runs in your system tray. Voice and text hotkeys. Connects to Gmail, Calendar, Drive, GitHub, and more.",
    url: "https://getyomi.in/download",
  },
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
