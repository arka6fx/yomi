import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Download",
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
