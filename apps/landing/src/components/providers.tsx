"use client"

import { Toaster } from "sonner"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "rgb(17 17 30)",
            border: "1px solid rgb(30 30 56)",
            color: "rgb(238 238 248)",
          },
        }}
      />
    </>
  )
}
