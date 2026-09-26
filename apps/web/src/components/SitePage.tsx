import type { ReactNode } from "react"
import { Mascot, type MascotPose } from "@/components/Mascot"
import Nav from "@/components/Nav"
import LandingFooter from "@/components/landing/LandingFooter"

// Chrome shared by every public page below the landing page: nav, content, footer.
export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-[radial-gradient(80%_40%_at_50%_0%,#dfe9f3_0%,transparent_70%)] text-foreground">
      <Nav />
      <main>{children}</main>
      <LandingFooter />
    </div>
  )
}

// The big lowercase page title with an optional eyebrow and lede.
export function PageIntro({
  eyebrow,
  title,
  children,
  center = false,
  mascot,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  children?: ReactNode
  center?: boolean
  mascot?: MascotPose
}) {
  const intro = (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && <p className="eyebrow mb-4">{eyebrow}</p>}
      <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
        {title}
      </h1>
      {children && (
        <div className="mt-5 text-[17px] leading-relaxed text-muted-foreground">{children}</div>
      )}
    </div>
  )
  if (!mascot) return intro
  return (
    <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      {intro}
      <Mascot pose={mascot} float className="w-20 shrink-0 sm:w-32 lg:w-40" />
    </div>
  )
}
