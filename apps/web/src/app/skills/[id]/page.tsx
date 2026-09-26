import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Clock, MessageCircle } from "lucide-react"
import { SitePage } from "@/components/SitePage"
import { Byline, SkillOrb } from "@/components/skills/SkillCard"
import { TelegramIcon } from "@/components/TelegramIcon"
import { APP_NAMES, SKILL_CATALOG, getCatalogSkill, skillTryLink } from "@/lib/skills-catalog"
import { pageMetadata } from "@/lib/site"
import { Mascot } from "@/components/Mascot"

export const dynamicParams = false

export function generateStaticParams() {
  return SKILL_CATALOG.map((skill) => ({ id: skill.id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const skill = getCatalogSkill((await params).id)
  if (!skill) return {}
  return pageMetadata({
    title: `${skill.name} skill`,
    description: skill.description,
    path: `/skills/${skill.id}`,
  })
}

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const skill = getCatalogSkill((await params).id)
  if (!skill) notFound()
  const apps = (skill.worksWith ?? []).map((id) => APP_NAMES[id] ?? id)

  return (
    <SitePage>
      <section className="mx-auto max-w-xl px-4 pb-24 pt-12 sm:pt-16">
        <div className="text-center">
          <Link href="/skills" className="chip hover:bg-card">
            <ArrowLeft size={14} /> browse the other skills
          </Link>
        </div>

        <div
          data-reveal
          className="surface relative mt-14 flex flex-col items-center px-6 py-10 text-center sm:px-10"
        >
          {/* the mascot perched on the card, reading up on the skill */}
          <Mascot
            pose="reading"
            float
            className="absolute -top-14 right-3 w-16 sm:-top-16 sm:right-6 sm:w-20"
          />
          <SkillOrb emoji={skill.emoji} size={84} />
          <p className="mt-4 text-sm text-muted-foreground">a skill for yomi · {skill.category}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold">
            {skill.kind === "routine" ? <Clock size={13} /> : <MessageCircle size={13} />}
            {skill.kind === "routine" ? "runs on a schedule" : "just ask"}
          </span>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            {skill.name}
          </h1>
          <span className="mt-3">
            <Byline />
          </span>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
        </div>

        <p className="mb-3 ml-1 mt-8 text-sm text-muted-foreground">what it&apos;ll do</p>
        <div data-reveal className="surface divide-y divide-border">
          <div className="flex items-start gap-3 p-5">
            <Clock size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-semibold">
                {skill.schedule ? skill.schedule : "whenever you ask"}
              </p>
              <p className="text-sm text-muted-foreground">
                {skill.kind === "routine"
                  ? "yomi runs it on this schedule and texts you the result on telegram. change the time from your dashboard."
                  : "open it on telegram and yomi walks you through it. no schedule needed."}
              </p>
            </div>
          </div>
          {apps.length > 0 && (
            <div className="flex items-start gap-3 p-5">
              <MessageCircle size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-semibold">better with {apps.join(" + ")}</p>
                <p className="text-sm text-muted-foreground">
                  connect them from your dashboard for richer results. the skill still works without
                  them.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <a
            href={skillTryLink(skill.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-telegram w-full py-3.5 text-base"
          >
            <span className="grid size-7 place-items-center rounded-full bg-white">
              <TelegramIcon size={22} />
            </span>
            try it on telegram
          </a>
          <Link href="/signup" className="text-sm text-muted-foreground">
            new to yomi?{" "}
            <span className="font-semibold text-foreground underline">sign up free</span>
          </Link>
        </div>
      </section>
    </SitePage>
  )
}
