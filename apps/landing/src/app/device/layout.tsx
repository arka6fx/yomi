import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Authorize Device",
  robots: { index: false, follow: false },
}

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
