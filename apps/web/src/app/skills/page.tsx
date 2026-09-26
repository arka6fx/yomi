import type { Metadata } from "next"
import { PageIntro, SitePage } from "@/components/SitePage"
import { SkillGallery } from "@/components/skills/SkillBrowser"
import { pageMetadata } from "@/lib/site"

export const dynamic = "force-static"

export const metadata: Metadata = pageMetadata({
  title: "Skills",
  description:
    "Ready-made things Yomi does for you: morning briefs, inbox follow-ups, deadline watch, spending recaps and more. Add one and Yomi starts on Telegram.",
  path: "/skills",
})

export default function SkillsPage() {
  return (
    <SitePage>
      <section className="mx-auto max-w-5xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
        <span className="chip mb-6">skills</span>
        <PageIntro title="give yomi a skill." mascot="reading">
          <p className="max-w-xl">
            skills are ready-made jobs for yomi. routines run on a schedule, like your morning brief
            or a sunday reset, and report back on telegram. the rest are things you just ask for.
            add one and yomi gets going today.
          </p>
        </PageIntro>

        <div className="mt-12">
          <SkillGallery />
        </div>
      </section>
    </SitePage>
  )
}
