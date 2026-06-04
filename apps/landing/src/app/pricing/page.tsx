"use client"

import { useEffect } from "react"
import { LandingPage } from "@/components/landing/landing-page"

export default function PricingPage() {
  useEffect(() => {
    document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })
  }, [])
  return <LandingPage />
}
