import type { Metadata } from "next"

// page.tsx is a client component and cannot export metadata, so the title lives here
export const metadata: Metadata = {
  title: "Developer",
  robots: { index: false, follow: false },
}

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
