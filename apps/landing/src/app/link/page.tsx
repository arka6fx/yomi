"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

function LinkPageContent() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard")
  }, [router])

  return null
}

export default function LinkPage() {
  return <LinkPageContent />
}
