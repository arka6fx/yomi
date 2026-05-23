import type { Metadata } from "next"

export const metadata: Metadata = { title: "Features" }

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
