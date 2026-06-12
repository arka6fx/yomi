"use client"

import { createAuthClient } from "better-auth/react"

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim()

export const authClient = createAuthClient(backendUrl ? { baseURL: backendUrl } : {})
