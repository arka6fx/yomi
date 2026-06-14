import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Link Account",
  robots: { index: false, follow: false },
}

export default function LinkLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
