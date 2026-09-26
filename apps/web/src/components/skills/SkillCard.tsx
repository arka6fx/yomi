import Link from "next/link"
import { BadgeCheck, Clock, MessageCircle } from "lucide-react"
import { APP_NAMES, shortSchedule, type CatalogSkill } from "@/lib/skills-catalog"

export function Byline() {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
      by yomi team <BadgeCheck size={13} className="text-brand" aria-label="official" />
    </span>
  )
}

// Rounded-square "app icon" for the gallery tiles.
export function SkillIcon({ emoji, size = 56 }: { emoji: string; size?: number }) {
  return (
    <span
      className="skill-icon shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {emoji}
    </span>
  )
}

export function SkillOrb({ emoji, size = 64 }: { emoji: string; size?: number }) {
  return (
    <span
      className="orb shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      aria-hidden
    >
      {emoji}
    </span>
  )
}

// Compact card: orb on the left, copy on the right. Used in the landing page rows.
export function SkillRowCard({ skill }: { skill: CatalogSkill }) {
  return (
    <Link
      href={`/skills/${skill.id}`}
      className="surface flex items-center gap-4 p-4 transition-transform hover:-translate-y-0.5"
    >
      <SkillOrb emoji={skill.emoji} />
      <span className="min-w-0">
        <span className="block font-semibold leading-tight text-foreground">{skill.name}</span>
        <Byline />
        <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          {skill.description}
        </span>
      </span>
    </Link>
  )
}

// Tall card for the skills gallery page.
export function SkillTile({ skill }: { skill: CatalogSkill }) {
  const apps = (skill.worksWith ?? []).map((id) => APP_NAMES[id] ?? id)
  return (
    <Link
      href={`/skills/${skill.id}`}
      className="surface flex flex-col !rounded-[1.6rem] p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_14px_34px_-14px_rgba(16,40,80,0.28)]"
    >
      <div className="flex items-start justify-between gap-3">
        <SkillIcon emoji={skill.emoji} size={54} />
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {skill.kind === "routine" ? <Clock size={12} /> : <MessageCircle size={12} />}
          {skill.schedule ? shortSchedule(skill.schedule) : "just ask"}
        </span>
      </div>
      <h3 className="mt-5 text-xl font-semibold text-foreground">{skill.name}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted-foreground">
        {skill.description}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <Byline />
        {apps.length > 0 && (
          <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
            works with {apps.join(" + ")}
          </span>
        )}
      </div>
    </Link>
  )
}

// Pill that reads like a request: "plan my week · with Weekly reset".
export function SkillAskPill({ skill }: { skill: CatalogSkill }) {
  return (
    <Link
      href={`/skills/${skill.id}`}
      className="surface flex items-center gap-3 !rounded-full py-2.5 pl-2.5 pr-5 transition-transform hover:-translate-y-0.5"
    >
      <SkillOrb emoji={skill.emoji} size={40} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-foreground">
          {skill.ask}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          with <span className="font-medium text-foreground/80">{skill.name.toLowerCase()}</span>
        </span>
      </span>
    </Link>
  )
}
