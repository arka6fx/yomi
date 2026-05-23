"use client"

import { useEffect } from "react"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import { LandingPage } from "@/components/landing/landing-page"

export default function FeaturesPage() {
  useEffect(() => {
    document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })
  }, [])
  return <LandingPage />
}
