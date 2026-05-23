import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/landing-page"

export const metadata: Metadata = {
  title: { absolute: "Yomi" },
}

export default function Home() {
  return <LandingPage />
}
