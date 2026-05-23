"use client"

import { useEffect } from "react"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import { LandingPage } from "@/components/landing/landing-page"

export default function PricingPage() {
  useEffect(() => {
    document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })
  }, [])
  return <LandingPage />
}
