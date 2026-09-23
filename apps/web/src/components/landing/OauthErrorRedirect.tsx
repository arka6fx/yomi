"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Google sends OAuth failures back to "/" with an ?error= code. Renders nothing; it exists
// only so the rest of the page did not have to be a client component for this one effect.
export function OauthErrorRedirect() {
  const router = useRouter()

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error")
    if (code) router.replace(`/signin?error=${encodeURIComponent(code)}`)
  }, [router])

  return null
}
