import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Link account",
  robots: { index: false, follow: false },
}

export default function LinkLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
