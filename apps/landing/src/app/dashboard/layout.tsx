import type { Metadata } from "next"
import { TITLE_TEMPLATE } from "@/lib/site"

// a plain-string title here would consume the root template, leaving nested
// segments (e.g. /dashboard/developer) with a bare, un-suffixed title
export const metadata: Metadata = {
  title: { default: "Dashboard", template: TITLE_TEMPLATE },
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
